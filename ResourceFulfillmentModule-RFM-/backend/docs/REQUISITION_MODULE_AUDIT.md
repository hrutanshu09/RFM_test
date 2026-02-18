# Requisition Module Technical Audit

## RBM Resource Fulfillment System

**Audit Date:** February 5, 2026  
**Scope:** Backend Requisition Module - Architecture & Workflow Analysis  
**Status:** DOCUMENTATION ONLY (No Changes Applied)

---

## 1. Module Overview

### 1.1 Files Scanned

| Category    | File Path                                 | Purpose                                                                 |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| **Router**  | `api/requisitions.py`                     | Main requisition CRUD, approvals, assignments, cancellation (730 lines) |
| **Router**  | `api/requisition_items.py`                | Item CRUD, employee assignment, status updates (256 lines)              |
| **Router**  | `api/requisition_status_history.py`       | Status history logging & retrieval (57 lines)                           |
| **Router**  | `api/dashboard.py`                        | Dashboard queries using requisition data                                |
| **Model**   | `db/models/requisition.py`                | Requisition ORM model (132 lines)                                       |
| **Model**   | `db/models/requisition_item.py`           | RequisitionItem ORM model (88 lines)                                    |
| **Model**   | `db/models/requisition_status_history.py` | Status history ORM model (37 lines)                                     |
| **Schema**  | `schemas/requisition.py`                  | Pydantic request/response schemas                                       |
| **Schema**  | `schemas/requisition_item.py`             | Item Pydantic schemas                                                   |
| **Schema**  | `schemas/requisition_status_history.py`   | History Pydantic schemas                                                |
| **Utility** | `utils/dependencies.py`                   | RBAC & status transition validation                                     |

### 1.2 Router Registration (main.py)

```python
app.include_router(requisitions_router, prefix="/api")          # /api/requisitions/*
app.include_router(requisition_items_router, prefix="/api")      # /api/requisitions/{id}/items/*
app.include_router(requisition_status_history_router, prefix="/api")  # /api/requisitions/{id}/status-history
```

---

## 2. Current Workflow Map

### 2.1 Requisition Header Statuses (8 Total)

| Status                         | Description                       | Entry Point                                                |
| ------------------------------ | --------------------------------- | ---------------------------------------------------------- |
| `Pending Budget Approval`      | Initial state on creation         | `create_requisition()`                                     |
| `Pending HR Approval`          | Budget approved, awaiting HR      | `approve_budget()`                                         |
| `Approved & Unassigned`        | HR approved, no TA assigned       | `approve_requisition()`, `approve_and_release()`           |
| `Active`                       | TA assigned, sourcing in progress | `assign_ta()`, `recalculate_requisition_status()`          |
| `Fulfilled`                    | All items fulfilled               | `recalculate_requisition_status()`                         |
| `Closed`                       | Cancelled or all items cancelled  | `cancel_requisition()`, `recalculate_requisition_status()` |
| `Closed (Partially Fulfilled)` | Mix of fulfilled + cancelled      | `recalculate_requisition_status()`                         |
| `Rejected`                     | HR rejected the request           | `reject_requisition()`                                     |

### 2.2 Requisition Item Statuses (5 Total)

| Status        | Description             | Set By                                              |
| ------------- | ----------------------- | --------------------------------------------------- |
| `Pending`     | Initial state           | `create_requisition_item()`, `create_requisition()` |
| `Sourcing`    | TA is actively sourcing | `update_item_status()`                              |
| `Shortlisted` | Candidates identified   | `update_item_status()`                              |
| `Fulfilled`   | Employee assigned       | `assign_employee_to_item()`, `update_item_status()` |
| `Cancelled`   | Item cancelled          | `update_item_status()`                              |

---

## 3. State Transition Map

### 3.1 Defined Transitions (utils/dependencies.py)

```python
allowed_transitions = {
    "Pending Budget Approval": {"Pending HR Approval", "Rejected"},
    "Pending HR Approval": {"Approved & Unassigned", "Rejected"},
    "Approved & Unassigned": {"Active"},
    "Active": {"Closed", "Fulfilled"},
}
```

### 3.2 Actual Transitions Found in Code

| From Status               | To Status                                       | Endpoint                           | Validation Used?                  |
| ------------------------- | ----------------------------------------------- | ---------------------------------- | --------------------------------- |
| `Pending Budget Approval` | `Pending HR Approval`                           | `approve_budget()`                 | ✅ `validate_status_transition()` |
| `Pending HR Approval`     | `Approved & Unassigned`                         | `approve_requisition()`            | ✅ `validate_status_transition()` |
| `Pending HR Approval`     | `Approved & Unassigned`                         | `approve_and_release()`            | ✅ `validate_status_transition()` |
| `Pending HR Approval`     | `Rejected`                                      | `reject_requisition()`             | ❌ Manual check only              |
| `Approved & Unassigned`   | `Active`                                        | `assign_ta()`                      | ✅ `validate_status_transition()` |
| `Active`                  | `Fulfilled/Closed/Closed (Partially Fulfilled)` | `recalculate_requisition_status()` | ❌ Business rule only             |
| **ANY**                   | `Closed`                                        | `cancel_requisition()`             | ❌ **NO VALIDATION**              |
| **ANY**                   | **ANY**                                         | `update_requisition_status()`      | ❌ **NO VALIDATION**              |
| **ANY**                   | **ANY**                                         | `update_requisition()`             | ❌ **NO VALIDATION**              |

### 3.3 Item Status Transitions

| From                   | To                                                 | Endpoint                    | Validation                     |
| ---------------------- | -------------------------------------------------- | --------------------------- | ------------------------------ |
| Any                    | `Pending/Sourcing/Shortlisted/Fulfilled/Cancelled` | `update_item_status()`      | ❌ Whitelist only              |
| Any (except Fulfilled) | `Fulfilled`                                        | `assign_employee_to_item()` | ✅ Blocks if already fulfilled |

---

## 4. Ownership Control Map

### 4.1 Ownership Fields on Requisition Model

| Field                | Type       | Purpose                             |
| -------------------- | ---------- | ----------------------------------- |
| `raised_by`          | FK → users | Manager who created the requisition |
| `assigned_ta`        | FK → users | TA responsible for fulfillment      |
| `budget_approved_by` | FK → users | Admin/HR who approved budget        |
| `approved_by`        | FK → users | HR who gave final approval          |

### 4.2 Ownership Enforcement Points

| Endpoint                       | Ownership Check             | Enforced?                                          |
| ------------------------------ | --------------------------- | -------------------------------------------------- |
| `update_requisition_manager()` | `raised_by == current_user` | ✅ Yes                                             |
| `upload_requisition_jd()`      | `raised_by == current_user` | ✅ Yes                                             |
| `delete_requisition_jd()`      | `raised_by == current_user` | ✅ Yes                                             |
| `approve_budget()`             | None                        | ❌ Role-only                                       |
| `approve_requisition()`        | None                        | ❌ Role-only                                       |
| `reject_requisition()`         | None                        | ❌ Role-only                                       |
| `assign_ta()`                  | None                        | ❌ Role-only                                       |
| `cancel_requisition()`         | None                        | ❌ **ANYONE with role can cancel ANY requisition** |
| `update_requisition()`         | None                        | ❌ Role-only                                       |
| `update_requisition_status()`  | None                        | ❌ Role-only                                       |
| `assign_employee_to_item()`    | None                        | ❌ Role-only                                       |
| `update_item_status()`         | None                        | ❌ Role-only                                       |

---

## 5. Status Calculation Logic

### 5.1 Aggregate Status Calculation (`recalculate_requisition_status()`)

Located in: `api/requisition_items.py` lines 44-125

```python
# Classification of "open-like" item statuses
open_like_statuses = ["Open", "In Progress", "Pending", "Sourcing", "Shortlisted"]

# Aggregation query counts:
# - total items
# - fulfilled items
# - cancelled items
# - open_like items

# Business Rules:
if open_like_count > 0:
    new_status = "Active"
elif fulfilled_count == total_count:
    new_status = "Fulfilled"
elif cancelled_count == total_count:
    new_status = "Closed"
elif fulfilled_count + cancelled_count == total_count:
    new_status = "Closed (Partially Fulfilled)"
```

### 5.2 Calculation Trigger Points

| Trigger                   | Function Called                    |
| ------------------------- | ---------------------------------- |
| Item created              | `recalculate_requisition_status()` |
| Employee assigned to item | `recalculate_requisition_status()` |
| Item status updated       | `recalculate_requisition_status()` |

### 5.3 Issues with Current Logic

1. **"Open" status in open_like_statuses doesn't exist** - Item model only allows: Pending, Sourcing, Shortlisted, Fulfilled, Cancelled
2. **"In Progress" status doesn't exist** - Same issue
3. **No trigger on item deletion** - If items are deleted, header status won't recalculate
4. **Race condition potential** - No proper locking mechanism across all trigger points

---

## 6. Assignment Logic

### 6.1 TA Assignment (Header Level)

**Endpoint:** `PATCH /api/requisitions/{req_id}/assign-ta`

```python
# Current Logic:
1. Check requisition exists
2. Check if already assigned (409 Conflict)
3. Check status == "Approved & Unassigned" (400 if not)
4. Validate transition to "Active"
5. Set assigned_ta, assigned_at, overall_status = "Active"
6. Record status history
7. Create audit log
8. Commit
```

**Issues:**

- No validation that `ta_user_id` is actually a user with TA role
- No limit on reassignment (once assigned, cannot reassign)

### 6.2 Employee Assignment (Item Level)

**Endpoint:** `PATCH /api/requisitions/items/{item_id}/assign`

```python
# Current Logic:
1. Check item exists
2. Check item not already Fulfilled (400)
3. Check employee exists
4. Check employee not assigned to another Fulfilled item (400)
5. Set assigned_emp_id, item_status = "Fulfilled"
6. Recalculate header status
7. Commit
```

**Issues:**

- Assignment immediately sets status to Fulfilled (no intermediate steps)
- No validation that requisition is in Active status
- No unassignment capability
- Duplicate assignment check only looks at Fulfilled items

---

## 7. Fulfillment Logic

### 7.1 Current Implementation

Fulfillment is **implicit** - it's determined by the aggregate item status calculation:

```python
if fulfilled_count == total_count:
    new_status = "Fulfilled"
```

### 7.2 Issues

1. **No explicit fulfillment action** - Header status changes automatically
2. **No verification step** - Manager cannot confirm fulfillment
3. **Immediate fulfillment on assignment** - No onboarding workflow integration
4. **No partial fulfillment tracking** - Only terminal state "Closed (Partially Fulfilled)"

---

## 8. Cancellation Logic

### 8.1 Header-Level Cancellation

**Endpoint:** `POST /api/requisitions/{req_id}/cancel`

```python
def cancel_requisition(req_id: int, ...):
    requisition = db.query(Requisition).filter(...).first()
    if not requisition:
        raise HTTPException(404)
    requisition.overall_status = "Closed"  # Direct assignment!
    db.commit()
    return {"message": "Requisition cancelled"}
```

**Critical Issues:**

1. ❌ **No status transition validation**
2. ❌ **No ownership check** - Anyone with Manager/Admin/HR role can cancel
3. ❌ **No status history recorded**
4. ❌ **No audit log created**
5. ❌ **Items are NOT cancelled** - They remain in their current status
6. ❌ **No cancellation reason required**
7. ❌ **Cannot cancel already Fulfilled requisitions** (business rule missing)

### 8.2 Item-Level Cancellation

Via `update_item_status()` with `status = "Cancelled"`

```python
# Only validation is status whitelist
if payload.status not in ("Pending", "Sourcing", "Shortlisted", "Fulfilled", "Cancelled"):
    raise HTTPException(400, "Invalid status")
```

**Issues:**

1. ❌ Can cancel Fulfilled items (should be blocked)
2. ❌ No reason/justification required
3. ❌ No audit trail for item status changes

---

## 9. Identified Architectural Weaknesses

### 9.1 Duplicate Logic

| Logic                       | Location 1                | Location 2                     | Issue                            |
| --------------------------- | ------------------------- | ------------------------------ | -------------------------------- |
| `_record_status_history()`  | `requisitions.py` line 37 | `requisition_items.py` line 24 | **Duplicated helper function**   |
| Status whitelist validation | `update_requisition()`    | `update_requisition_status()`  | **Hardcoded in multiple places** |
| Status whitelist            | Model CheckConstraint     | Router validation              | **Not centralized**              |
| Item status whitelist       | Model CheckConstraint     | `update_item_status()`         | **Not centralized**              |

### 9.2 Scattered Business Rules

| Business Rule             | Expected Location       | Actual Location                       |
| ------------------------- | ----------------------- | ------------------------------------- |
| Status transitions        | Central workflow engine | `utils/dependencies.py` (partial)     |
| Header status calculation | Central workflow engine | `requisition_items.py` (inline)       |
| Ownership validation      | Central workflow engine | Scattered across endpoints            |
| Assignment validation     | Central workflow engine | Inline in `assign_employee_to_item()` |

### 9.3 Missing Transaction Boundaries

| Operation                          | Issue                                                |
| ---------------------------------- | ---------------------------------------------------- |
| `create_requisition()`             | ✅ Has explicit rollback try/catch                   |
| `update_requisition_manager()`     | ❌ No explicit transaction                           |
| `approve_requisition()`            | ⚠️ Uses `with_for_update()` but no explicit boundary |
| `assign_ta()`                      | ⚠️ Uses `with_for_update()` but no explicit boundary |
| `reject_requisition()`             | ⚠️ Uses `with_for_update()` but no explicit boundary |
| `recalculate_requisition_status()` | ⚠️ Uses `with_for_update()` but caller commits       |

### 9.4 Missing RBAC Enforcement

| Enforcement Gap                        | Risk Level       |
| -------------------------------------- | ---------------- |
| No TA role validation on `assign_ta()` | Medium           |
| No owner-only edit after approval      | Medium           |
| Any HR can reject any requisition      | Low (acceptable) |
| Any Manager can cancel any requisition | **HIGH**         |
| No item-level ownership                | Medium           |

### 9.5 Direct DB Manipulation in Routers

All business logic is implemented **directly in route handlers**:

```python
# Example from cancel_requisition()
requisition.overall_status = "Closed"  # Direct model mutation
db.commit()
```

**No service layer exists.** All 730+ lines of `requisitions.py` are router code with embedded business logic.

### 9.6 Manual Header Status Changes

Multiple endpoints allow direct status override:

| Endpoint                                         | Bypass Risk                |
| ------------------------------------------------ | -------------------------- |
| `PATCH /requisitions/{id}` with `overall_status` | Can bypass entire workflow |
| `PATCH /requisitions/{id}/status`                | Can set arbitrary status   |

### 9.7 Lack of Centralized State Engine

| Missing Component        | Impact                                      |
| ------------------------ | ------------------------------------------- |
| State machine definition | Transitions scattered across multiple files |
| Action-based transitions | Status changes via direct assignment        |
| Guard conditions         | Validation inline, inconsistent             |
| Side effect hooks        | Status history, audit logging done manually |
| Rollback handling        | Only in `create_requisition()`              |

---

## 10. API Endpoint Inventory

### 10.1 Requisitions Router (`/api/requisitions`)

| Method | Path                        | Purpose                     | RBAC                             |
| ------ | --------------------------- | --------------------------- | -------------------------------- |
| POST   | `/`                         | Create requisition          | Manager, Admin, HR               |
| GET    | `/`                         | List requisitions           | Manager, Admin, HR, Employee, TA |
| GET    | `/my`                       | List my requisitions        | Manager, Admin, HR, Employee, TA |
| GET    | `/{req_id}`                 | Get requisition             | Manager, Admin, HR, Employee, TA |
| PUT    | `/{req_id}`                 | Manager update (with items) | Manager                          |
| PATCH  | `/{req_id}`                 | Generic update              | Manager, Admin, HR               |
| PATCH  | `/{req_id}/status`          | Direct status update        | Manager, Admin, HR               |
| PATCH  | `/{req_id}/approve-budget`  | Budget approval             | Admin, HR                        |
| PUT    | `/{req_id}/approve`         | HR approval                 | HR                               |
| PATCH  | `/{req_id}/approve-release` | Combined approval           | Admin, HR                        |
| PATCH  | `/{req_id}/assign-ta`       | Assign TA                   | Admin, HR                        |
| PUT    | `/{req_id}/reject`          | Reject requisition          | HR                               |
| POST   | `/{req_id}/cancel`          | Cancel requisition          | Manager, Admin, HR               |
| GET    | `/{req_id}/jd`              | Download JD                 | Manager, Admin, HR, TA           |
| POST   | `/{req_id}/jd`              | Upload JD                   | Manager                          |
| DELETE | `/{req_id}/jd`              | Delete JD                   | Manager                          |

### 10.2 Requisition Items Router (`/api/requisitions`)

| Method | Path                      | Purpose            | RBAC                   |
| ------ | ------------------------- | ------------------ | ---------------------- |
| POST   | `/{req_id}/items`         | Create item        | Manager, Admin, HR     |
| GET    | `/{req_id}/items`         | List items         | None (open)            |
| PATCH  | `/items/{item_id}/assign` | Assign employee    | Manager, Admin, HR, TA |
| PATCH  | `/items/{item_id}/status` | Update item status | Manager, Admin, HR, TA |

### 10.3 Status History Router (`/api/requisitions`)

| Method | Path                       | Purpose              | RBAC                         |
| ------ | -------------------------- | -------------------- | ---------------------------- |
| POST   | `/{req_id}/status-history` | Create history entry | Manager, Admin, HR           |
| GET    | `/{req_id}/status-history` | List history         | Manager, Admin, HR, Employee |

---

## 11. Summary of Critical Issues

### 11.1 HIGH Priority

1. **`cancel_requisition()` has no validation** - Can cancel from any state
2. **`update_requisition_status()` bypasses workflow** - Direct status override
3. **`update_requisition()` allows status change** - Another bypass route
4. **No ownership on cancellation** - Any role can cancel any requisition
5. **No service layer** - All logic in routers

### 11.2 MEDIUM Priority

1. **Duplicate `_record_status_history()` function**
2. **Hardcoded status lists in multiple locations**
3. **No TA role validation in `assign_ta()`**
4. **Item assignment immediately fulfills** - No intermediate state
5. **`open_like_statuses` contains non-existent statuses**
6. **Items not auto-cancelled when header cancelled**

### 11.3 LOW Priority

1. **`list_requisition_items()` has no auth**
2. **Status history can be created directly via API**
3. **No audit logging for item status changes**
4. **Duplicate imports in requisitions.py** (mentioned in copilot-instructions)

---

## 12. Recommended Architecture (For Future Implementation)

### 12.1 Proposed Service Layer Structure

```
backend/
├── services/
│   └── requisition/
│       ├── __init__.py
│       ├── workflow.py          # State machine & transitions
│       ├── service.py           # Business operations
│       ├── validators.py        # Guard conditions
│       └── events.py            # Side effects (history, audit)
```

### 12.2 Proposed State Machine

```python
# Centralized state definitions
class RequisitionStatus(Enum):
    DRAFT = "Draft"
    PENDING_BUDGET = "Pending Budget Approval"
    PENDING_HR = "Pending HR Approval"
    APPROVED = "Approved & Unassigned"
    ACTIVE = "Active"
    FULFILLED = "Fulfilled"
    CLOSED = "Closed"
    PARTIALLY_FULFILLED = "Closed (Partially Fulfilled)"
    REJECTED = "Rejected"

# Centralized transitions
TRANSITIONS = {
    (DRAFT, "submit"): PENDING_BUDGET,
    (PENDING_BUDGET, "approve_budget"): PENDING_HR,
    (PENDING_BUDGET, "reject"): REJECTED,
    (PENDING_HR, "approve"): APPROVED,
    (PENDING_HR, "reject"): REJECTED,
    (APPROVED, "assign_ta"): ACTIVE,
    (ACTIVE, "fulfill"): FULFILLED,
    (ACTIVE, "cancel"): CLOSED,
    # ... etc
}
```

---

## 13. Appendix: Code Locations Reference

### Status Update Locations

| File                 | Line    | Function                           | Status Changed            |
| -------------------- | ------- | ---------------------------------- | ------------------------- |
| requisitions.py      | 106     | `create_requisition()`             | → Pending Budget Approval |
| requisitions.py      | 424     | `update_requisition()`             | → Any (via payload)       |
| requisitions.py      | 466     | `update_requisition_status()`      | → Any (via payload)       |
| requisitions.py      | 490     | `approve_budget()`                 | → Pending HR Approval     |
| requisitions.py      | 515     | `approve_requisition()`            | → Approved & Unassigned   |
| requisitions.py      | 543     | `approve_and_release()`            | → Approved & Unassigned   |
| requisitions.py      | 567     | `assign_ta()`                      | → Active                  |
| requisitions.py      | 614     | `reject_requisition()`             | → Rejected                |
| requisitions.py      | 648     | `cancel_requisition()`             | → Closed                  |
| requisition_items.py | 115-124 | `recalculate_requisition_status()` | → Active/Fulfilled/Closed |

### History Recording Locations

| File                 | Line  | Function                   |
| -------------------- | ----- | -------------------------- |
| requisitions.py      | 37-52 | `_record_status_history()` |
| requisition_items.py | 24-38 | `_record_status_history()` |

---

**END OF AUDIT DOCUMENT**

_This document describes the current implementation state. No code changes have been made._
