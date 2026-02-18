"""
Database Schema Validation Utilities

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides utilities to verify database schema integrity
against the workflow specification. Run during startup or as a health check.
"""

from typing import Dict, List, Tuple, Optional
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from dataclasses import dataclass


@dataclass
class ValidationResult:
    """Result of a single validation check."""
    check_name: str
    passed: bool
    message: str
    severity: str = "ERROR"  # ERROR, WARNING, INFO


class SchemaValidator:
    """
    Validates database schema against workflow specification requirements.
    
    Usage:
        validator = SchemaValidator(db)
        results = validator.validate_all()
        if not validator.is_valid():
            for r in results:
                if not r.passed:
                    print(f"{r.severity}: {r.check_name} - {r.message}")
    """
    
    REQUIRED_HEADER_STATUSES = {
        'Draft', 'Pending_Budget', 'Pending_HR', 'Active', 
        'Fulfilled', 'Rejected', 'Cancelled'
    }
    
    REQUIRED_ITEM_STATUSES = {
        'Pending', 'Sourcing', 'Shortlisted', 'Interviewing',
        'Offered', 'Fulfilled', 'Cancelled'
    }
    
    def __init__(self, db: Session):
        self.db = db
        self.results: List[ValidationResult] = []
    
    def validate_all(self) -> List[ValidationResult]:
        """Run all validation checks."""
        self.results = []
        
        self._check_version_columns()
        self._check_status_constraints()
        self._check_required_indexes()
        self._check_foreign_keys()
        self._check_fulfillment_constraint()
        
        return self.results
    
    def is_valid(self) -> bool:
        """Return True if all ERROR-level checks passed."""
        return all(
            r.passed or r.severity != "ERROR" 
            for r in self.results
        )
    
    def _add_result(
        self, 
        check_name: str, 
        passed: bool, 
        message: str,
        severity: str = "ERROR"
    ):
        self.results.append(ValidationResult(
            check_name=check_name,
            passed=passed,
            message=message,
            severity=severity
        ))
    
    def _check_version_columns(self):
        """Verify version columns exist and are NOT NULL."""
        # Check requisitions.version
        result = self.db.execute(text("""
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'requisitions' AND column_name = 'version'
        """)).fetchone()
        
        if result is None:
            self._add_result(
                "requisitions.version_exists",
                False,
                "Column 'version' not found in requisitions table"
            )
        elif result[1] == 'YES':
            self._add_result(
                "requisitions.version_nullable",
                False,
                "Column 'version' in requisitions is nullable (should be NOT NULL)"
            )
        else:
            self._add_result(
                "requisitions.version",
                True,
                "Version column correctly configured"
            )
        
        # Check requisition_items.version
        result = self.db.execute(text("""
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'requisition_items' AND column_name = 'version'
        """)).fetchone()
        
        if result is None:
            self._add_result(
                "requisition_items.version_exists",
                False,
                "Column 'version' not found in requisition_items table"
            )
        elif result[1] == 'YES':
            self._add_result(
                "requisition_items.version_nullable",
                False,
                "Column 'version' in requisition_items is nullable (should be NOT NULL)"
            )
        else:
            self._add_result(
                "requisition_items.version",
                True,
                "Version column correctly configured"
            )
    
    def _check_status_constraints(self):
        """Verify CHECK constraints match workflow specification."""
        # Check requisition status constraint
        result = self.db.execute(text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE c.conname = 'chk_requisition_status'
            AND c.contype = 'c'
        """)).fetchone()
        
        if result is None:
            self._add_result(
                "chk_requisition_status",
                False,
                "Constraint 'chk_requisition_status' not found"
            )
        else:
            constraint_def = result[0]
            missing = []
            for status in self.REQUIRED_HEADER_STATUSES:
                if f"'{status}'" not in constraint_def:
                    missing.append(status)
            
            if missing:
                self._add_result(
                    "chk_requisition_status_values",
                    False,
                    f"Missing statuses in constraint: {missing}"
                )
            else:
                self._add_result(
                    "chk_requisition_status",
                    True,
                    "Requisition status constraint is correct"
                )
        
        # Check item status constraint
        result = self.db.execute(text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE c.conname = 'chk_requisition_item_status'
            AND c.contype = 'c'
        """)).fetchone()
        
        if result is None:
            self._add_result(
                "chk_requisition_item_status",
                False,
                "Constraint 'chk_requisition_item_status' not found"
            )
        else:
            constraint_def = result[0]
            missing = []
            for status in self.REQUIRED_ITEM_STATUSES:
                if f"'{status}'" not in constraint_def:
                    missing.append(status)
            
            if missing:
                self._add_result(
                    "chk_requisition_item_status_values",
                    False,
                    f"Missing statuses in item constraint: {missing}"
                )
            else:
                self._add_result(
                    "chk_requisition_item_status",
                    True,
                    "Item status constraint is correct"
                )
    
    def _check_required_indexes(self):
        """Verify required indexes exist."""
        required_indexes = [
            ('requisitions', 'ix_requisitions_overall_status'),
            ('requisition_items', 'ix_requisition_items_item_status'),
            ('requisition_items', 'ix_requisition_items_req_id'),
        ]
        
        for table, index_name in required_indexes:
            result = self.db.execute(text("""
                SELECT indexname FROM pg_indexes
                WHERE tablename = :table AND indexname = :index
            """), {"table": table, "index": index_name}).fetchone()
            
            if result is None:
                # Check for any index on the column (name might differ)
                self._add_result(
                    f"index_{index_name}",
                    False,
                    f"Index '{index_name}' not found on {table}",
                    severity="WARNING"
                )
            else:
                self._add_result(
                    f"index_{index_name}",
                    True,
                    f"Index '{index_name}' exists"
                )
    
    def _check_foreign_keys(self):
        """Verify foreign key constraints have proper ON DELETE rules."""
        fk_checks = [
            ('requisitions', 'raised_by', 'RESTRICT'),
            ('requisitions', 'assigned_ta', 'RESTRICT'),
            ('requisition_items', 'req_id', 'RESTRICT'),
            ('requisition_items', 'assigned_ta', 'RESTRICT'),
        ]
        
        for table, column, expected_action in fk_checks:
            # Use %s placeholder with explicit table name to avoid ::regclass conflict
            result = self.db.execute(text(f"""
                SELECT confdeltype
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attnum = ANY(c.conkey)
                WHERE c.conrelid = '{table}'::regclass
                AND a.attname = :column
                AND c.contype = 'f'
            """), {"column": column}).fetchone()
            
            if result is None:
                self._add_result(
                    f"fk_{table}_{column}",
                    False,
                    f"Foreign key on {table}.{column} not found",
                    severity="WARNING"
                )
            else:
                action_map = {'a': 'NO ACTION', 'r': 'RESTRICT', 'c': 'CASCADE', 'n': 'SET NULL', 'd': 'SET DEFAULT'}
                actual_action = action_map.get(result[0], 'UNKNOWN')
                
                # RESTRICT and NO ACTION are functionally equivalent
                if actual_action in ('RESTRICT', 'NO ACTION') and expected_action == 'RESTRICT':
                    self._add_result(
                        f"fk_{table}_{column}",
                        True,
                        f"FK {table}.{column} has {actual_action} on delete"
                    )
                elif actual_action != expected_action:
                    self._add_result(
                        f"fk_{table}_{column}_action",
                        False,
                        f"FK {table}.{column} has {actual_action}, expected {expected_action}",
                        severity="WARNING"
                    )
                else:
                    self._add_result(
                        f"fk_{table}_{column}",
                        True,
                        f"FK {table}.{column} correctly configured"
                    )
    
    def _check_fulfillment_constraint(self):
        """Verify GC-004: Fulfilled items must have employee assigned."""
        result = self.db.execute(text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            WHERE c.conname = 'chk_fulfilled_has_employee'
            AND c.contype = 'c'
        """)).fetchone()
        
        if result is None:
            self._add_result(
                "chk_fulfilled_has_employee",
                False,
                "Constraint 'chk_fulfilled_has_employee' not found (GC-004)"
            )
        else:
            self._add_result(
                "chk_fulfilled_has_employee",
                True,
                "Fulfillment constraint (GC-004) exists"
            )


def run_schema_validation(db: Session) -> Tuple[bool, List[ValidationResult]]:
    """
    Run complete schema validation and return results.
    
    Returns:
        Tuple of (is_valid, results)
    """
    validator = SchemaValidator(db)
    results = validator.validate_all()
    return validator.is_valid(), results


def print_validation_report(results: List[ValidationResult]) -> None:
    """Print a formatted validation report."""
    print("\n" + "=" * 60)
    print("DATABASE SCHEMA VALIDATION REPORT")
    print("=" * 60)
    
    errors = [r for r in results if not r.passed and r.severity == "ERROR"]
    warnings = [r for r in results if not r.passed and r.severity == "WARNING"]
    passed = [r for r in results if r.passed]
    
    if errors:
        print(f"\n❌ ERRORS ({len(errors)}):")
        for r in errors:
            print(f"   - {r.check_name}: {r.message}")
    
    if warnings:
        print(f"\n⚠️  WARNINGS ({len(warnings)}):")
        for r in warnings:
            print(f"   - {r.check_name}: {r.message}")
    
    print(f"\n✅ PASSED ({len(passed)}):")
    for r in passed:
        print(f"   - {r.check_name}")
    
    print("\n" + "=" * 60)
    if errors:
        print("STATUS: FAILED - Schema does not match specification")
    elif warnings:
        print("STATUS: PASSED WITH WARNINGS")
    else:
        print("STATUS: PASSED - Schema matches specification")
    print("=" * 60 + "\n")
