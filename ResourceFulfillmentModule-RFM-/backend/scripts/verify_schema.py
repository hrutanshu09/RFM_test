#!/usr/bin/env python
"""
Schema Verification Script

Run this script after deployment to verify the database schema
matches the expected workflow specification.

Usage:
    python scripts/verify_schema.py

Exit codes:
    0 - All validations passed
    1 - One or more validations failed
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from services.requisition.schema_validation import SchemaValidator, print_validation_report


def main():
    """Run schema validation and report results."""
    print("=" * 60)
    print("RBM Resource Module — Schema Verification")
    print("Workflow Specification v1.0.0")
    print("=" * 60)
    print()
    
    db = SessionLocal()
    try:
        validator = SchemaValidator(db)
        results = validator.validate_all()
        
        # Print detailed results
        print_validation_report(results)
        
        # Check for failures
        failed = [r for r in results if not r.passed]
        warnings = [r for r in results if r.severity == "WARNING" and not r.passed]
        
        print()
        print("=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total checks: {len(results)}")
        print(f"Passed: {len(results) - len(failed)}")
        print(f"Failed: {len(failed)}")
        print(f"Warnings: {len(warnings)}")
        print()
        
        if failed:
            print("❌ SCHEMA VALIDATION FAILED")
            print()
            print("Failed checks:")
            for result in failed:
                print(f"  • {result.check_name}")
                print(f"    {result.message}")
            print()
            print("Please review and fix the issues above before proceeding.")
            return 1
        else:
            print("✓ All schema validations passed")
            print()
            print("The database schema is compliant with Workflow Specification v1.0.0")
            return 0
            
    except Exception as e:
        print(f"❌ ERROR: Failed to run schema validation")
        print(f"   {type(e).__name__}: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
