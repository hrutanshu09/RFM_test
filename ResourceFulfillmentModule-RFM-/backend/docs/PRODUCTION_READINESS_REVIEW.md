# Workflow System — Production Readiness Review

**RBM Resource Fulfillment Module — Workflow Specification v1.0.0**

This document provides a comprehensive production readiness checklist, migration verification procedures, CI integration guidance, and hardening recommendations.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Migration Verification](#migration-verification)
3. [CI/CD Integration](#cicd-integration)
4. [Production Hardening](#production-hardening)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment Checklist

### 1. Database Migrations

- [ ] **Run all pending migrations**

  ```bash
  cd backend
  alembic upgrade head
  ```

- [ ] **Verify migration sequence**

  ```bash
  alembic history
  ```

  Expected order:
  1. `wf_spec_v1_constraints` — CHECK constraints for workflow states
  2. `wf_transition_audit` — Audit logging table
  3. `wf_defense_indexes` — Performance indexes

- [ ] **Validate schema constraints**

  ```python
  from services.requisition.schema_validation import SchemaValidator
  from database import SessionLocal

  db = SessionLocal()
  validator = SchemaValidator(db)
  results = validator.validate_all()
  validator.print_report(results)
  # Expected: All checks PASS
  ```

### 2. Status Protection Verification

- [ ] **Verify status protection is registered**

  ```python
  from services.requisition.status_protection import _protection_registered
  assert _protection_registered, "Status protection not registered!"
  ```

- [ ] **Test direct mutation is blocked**

  ```python
  from services.requisition.status_protection import StatusProtectionError
  from db.models.requisition import Requisition

  req = db.query(Requisition).first()
  try:
      req.overall_status = "ACTIVE"
      db.flush()
      raise AssertionError("Direct mutation should have been blocked!")
  except StatusProtectionError:
      print("✓ Status protection working correctly")
      db.rollback()
  ```

### 3. Workflow Engine Verification

- [ ] **Verify workflow transitions work through engine**

  ```python
  from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
  from services.requisition.workflow_matrix import RequisitionStatus

  # Create test requisition in DRAFT
  # Then verify: submit() transitions to PENDING_BUDGET
  ```

- [ ] **Verify invalid transitions are blocked**

  ```python
  from services.requisition.workflow_exceptions import InvalidTransitionException

  # Try to transition DRAFT directly to ACTIVE
  # Should raise InvalidTransitionException
  ```

### 4. Concurrency Handling

- [ ] **Verify optimistic locking works**

  ```python
  from services.requisition.workflow_exceptions import ConcurrencyConflictException

  # Attempt transition with stale version
  # Should raise ConcurrencyConflictException
  ```

### 5. Audit Logging

- [ ] **Verify transitions create audit records**

  ```python
  from db.models.workflow_audit import WorkflowTransitionAudit

  # After a transition, verify audit record exists with:
  # - Correct entity_type, entity_id
  # - Correct from_status, to_status
  # - version_before, version_after
  # - performed_by, user_roles
  ```

---

## Migration Verification

### Automated Schema Drift Check

Run this check after deploying to verify database matches expected schema:

```python
# scripts/verify_schema.py
import sys
from database import SessionLocal
from services.requisition.schema_validation import SchemaValidator

def main():
    db = SessionLocal()
    try:
        validator = SchemaValidator(db)
        results = validator.validate_all()

        failed = [r for r in results if not r["passed"]]

        if failed:
            print("❌ SCHEMA VALIDATION FAILED")
            for result in failed:
                print(f"  - {result['check']}: {result['message']}")
            sys.exit(1)
        else:
            print("✓ All schema validations passed")
            sys.exit(0)
    finally:
        db.close()

if __name__ == "__main__":
    main()
```

### Manual Constraint Verification

Check PostgreSQL constraints directly:

```sql
-- Verify CHECK constraints exist
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'requisitions'::regclass
  AND contype = 'c';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'requisition_items'::regclass
  AND contype = 'c';

-- Expected output should include:
-- ck_requisitions_overall_status
-- ck_requisition_items_item_status
-- ck_requisition_items_fulfilled_employee
```

### Migration History Audit

```bash
# Compare migration history against expected
alembic history --verbose

# Ensure all migrations are applied
alembic current
# Should show: wf_defense_indexes (head)
```

---

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/workflow-tests.yml`:

```yaml
name: Workflow System Tests

on:
  push:
    branches: [main, develop]
    paths:
      - "backend/services/requisition/**"
      - "backend/db/models/requisition*.py"
      - "backend/alembic/versions/**"
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-asyncio

      - name: Run migrations
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: test
          DB_PASSWORD: test
          DB_NAME: test_db
        run: |
          cd backend
          alembic upgrade head

      - name: Run workflow tests
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: test
          DB_PASSWORD: test
          DB_NAME: test_db
        run: |
          cd backend
          pytest tests/test_workflow_integration.py -v
          pytest tests/test_workflow_concurrency.py -v

      - name: Verify schema
        run: |
          cd backend
          python scripts/verify_schema.py
```

### Pre-commit Hook

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: workflow-unit-tests
        name: Workflow Unit Tests
        entry: pytest backend/tests/test_workflow_unit.py -v --tb=short
        language: system
        pass_filenames: false
        files: ^backend/services/requisition/
```

### Required Test Coverage

Ensure these test categories pass before deployment:

1. **Unit Tests** (`test_workflow_unit.py`)
   - All transition matrix validations
   - Role authorization checks
   - Exception handling

2. **Integration Tests** (`test_workflow_integration.py`)
   - API endpoint transitions
   - Status protection enforcement
   - Audit logging verification

3. **Concurrency Tests** (`test_workflow_concurrency.py`)
   - Optimistic locking conflicts
   - Concurrent transition handling

---

## Production Hardening

### 1. Connection Pool Settings

```python
# database.py - Recommended settings
SQLALCHEMY_DATABASE_URL = f"postgresql://{user}:{password}@{host}:{port}/{db}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=20,              # Base pool size
    max_overflow=10,           # Additional connections when needed
    pool_timeout=30,           # Wait time for connection
    pool_recycle=1800,         # Recycle connections every 30 min
    pool_pre_ping=True,        # Verify connections before use
)
```

### 2. Transaction Timeouts

```python
# For long-running operations
from sqlalchemy import text

with db.begin():
    db.execute(text("SET LOCAL statement_timeout = '30s'"))
    # ... workflow operation
```

### 3. Query Optimization

Ensure indexes are used effectively:

```sql
-- Analyze query plans for common operations
EXPLAIN ANALYZE
SELECT * FROM requisitions
WHERE overall_status = 'ACTIVE'
ORDER BY created_at DESC
LIMIT 50;

-- Should use: ix_requisitions_overall_status
```

### 4. Rate Limiting

Protect transition endpoints from abuse:

```python
from fastapi import Request
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter

# Apply to transition endpoints
@router.post(
    "/{req_id}/submit",
    dependencies=[Depends(RateLimiter(times=10, seconds=60))]
)
async def submit_requisition(req_id: int, ...):
    ...
```

### 5. Health Check Endpoint

```python
@router.get("/health/workflow")
async def workflow_health_check(db: Session = Depends(get_db)):
    """Verify workflow system health."""
    from services.requisition.schema_validation import SchemaValidator

    validator = SchemaValidator(db)
    version_check = validator.check_version_columns()
    constraint_check = validator.check_status_constraints()

    healthy = all(r["passed"] for r in [version_check] + constraint_check)

    return {
        "status": "healthy" if healthy else "degraded",
        "checks": {
            "version_columns": version_check["passed"],
            "status_constraints": all(r["passed"] for r in constraint_check),
        }
    }
```

---

## Monitoring & Alerting

### Key Metrics to Monitor

1. **Transition Success Rate**
   - Track: `workflow.transition.success` / `workflow.transition.total`
   - Alert if: < 95%

2. **Concurrency Conflicts**
   - Track: `workflow.concurrency_conflict.count`
   - Alert if: > 10/min (indicates contention)

3. **Status Distribution**

   ```sql
   SELECT overall_status, COUNT(*)
   FROM requisitions
   GROUP BY overall_status;
   ```

4. **Stuck Requisitions**

   ```sql
   -- Requisitions stuck in non-terminal state > 7 days
   SELECT req_id, overall_status, created_at
   FROM requisitions
   WHERE overall_status NOT IN ('FULFILLED', 'REJECTED', 'CANCELLED')
     AND created_at < NOW() - INTERVAL '7 days';
   ```

5. **Audit Log Growth**
   ```sql
   SELECT COUNT(*) FROM workflow_transition_audit
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

### Prometheus Metrics (via workflow_hooks.py)

```python
# Example metrics hook integration
from prometheus_client import Counter, Histogram

transition_counter = Counter(
    'workflow_transitions_total',
    'Total workflow transitions',
    ['entity_type', 'from_status', 'to_status']
)

transition_duration = Histogram(
    'workflow_transition_duration_seconds',
    'Time spent processing transitions',
    ['entity_type', 'action']
)
```

### Alerting Rules (Prometheus)

```yaml
groups:
  - name: workflow_alerts
    rules:
      - alert: HighConcurrencyConflicts
        expr: rate(workflow_concurrency_conflicts_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate of concurrency conflicts"

      - alert: StuckRequisitions
        expr: workflow_stuck_requisitions_count > 10
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Multiple requisitions stuck in pending states"
```

---

## Rollback Procedures

### If Workflow Issues Detected Post-Deployment

1. **Immediate Mitigation**

   ```python
   # Disable status protection if blocking operations
   from services.requisition.status_protection import unregister_status_protection
   unregister_status_protection()
   ```

2. **Database Rollback (if needed)**

   ```bash
   # Roll back to previous migration
   alembic downgrade -1

   # Or to specific revision
   alembic downgrade wf_transition_audit
   ```

3. **Emergency Direct Status Fix**

   ```python
   # ONLY in emergency, bypass protection
   from services.requisition.status_protection import workflow_transition_context

   with workflow_transition_context():
       req.overall_status = "DRAFT"  # Emergency fix
       db.commit()
   ```

### Version Rollback Procedure

If rolling back application version:

1. Check current migration head
2. Determine target migration for rollback version
3. Run `alembic downgrade <target>`
4. Deploy previous application version
5. Verify with schema validation

---

## Summary

This production readiness review covers:

| Area                | Status      | Notes                            |
| ------------------- | ----------- | -------------------------------- |
| Database Migrations | ✅ Ready    | 3 migrations applied             |
| Status Protection   | ✅ Ready    | SQLAlchemy event listeners       |
| Workflow Engine     | ✅ Ready    | V2 with full spec compliance     |
| Concurrency Control | ✅ Ready    | Optimistic locking               |
| Audit Logging       | ✅ Ready    | Comprehensive with versions      |
| Integration Tests   | ✅ Ready    | Full transition coverage         |
| Concurrency Tests   | ✅ Ready    | Collision handling verified      |
| Extension Hooks     | ✅ Ready    | Plugin architecture              |
| CI Integration      | 📋 Template | GitHub Actions workflow provided |
| Monitoring          | 📋 Template | Prometheus metrics hook provided |

**Deployment Confidence: HIGH**

The workflow system implements:

- ✅ Strict enum-based state machines
- ✅ Role-based authorization
- ✅ Optimistic + pessimistic locking
- ✅ Comprehensive audit trail
- ✅ Database-level constraints
- ✅ SQLAlchemy-level protection
- ✅ Extensible hook system
