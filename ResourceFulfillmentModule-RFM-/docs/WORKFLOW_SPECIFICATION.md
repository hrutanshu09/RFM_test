# RBM Resource Fulfillment Module — Official Workflow Specification

**Document Version:** 1.0.0  
**Status:** APPROVED FOR IMPLEMENTATION  
**Effective Date:** 2026-02-05  
**Classification:** Internal — Engineering Reference

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Terminology & Definitions](#2-terminology--definitions)
3. [Requisition Header Lifecycle](#3-requisition-header-lifecycle)
4. [Requisition Item Lifecycle](#4-requisition-item-lifecycle)
5. [Role-Based Transition Authority Matrix](#5-role-based-transition-authority-matrix)
6. [Header-Item Synchronization Rules](#6-header-item-synchronization-rules)
7. [Hard Governance Constraints](#7-hard-governance-constraints)
8. [Database Enforcement Strategy](#8-database-enforcement-strategy)
9. [API Validation Strategy](#9-api-validation-strategy)
10. [Edge Case Handling](#10-edge-case-handling)
11. [Audit Requirements](#11-audit-requirements)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Executive Summary

This document defines the **official workflow contract** for the RBM Resource Fulfillment Module. All backend services, database constraints, and API validations **MUST** conform to the specifications herein.

### 1.1 Design Principles

| Principle                  | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| **Deterministic**          | Every state has explicitly defined outbound transitions              |
| **Auditable**              | Every transition is logged with actor, timestamp, and context        |
| **Non-Circular**           | No transition loops except via explicit reopen (disabled by default) |
| **Terminal Finality**      | Terminal states are irreversible unless system override              |
| **Separation of Concerns** | Header = approval workflow; Item = fulfillment workflow              |
| **Least Privilege**        | Roles can only perform explicitly authorized transitions             |

### 1.2 System Roles

| Role               | Code      | Primary Responsibility              |
| ------------------ | --------- | ----------------------------------- |
| Manager            | `MANAGER` | Create requisitions, approve budget |
| HR                 | `HR`      | HR approval, compliance oversight   |
| Talent Acquisition | `TA`      | Candidate sourcing and fulfillment  |
| Administrator      | `ADMIN`   | System override, emergency actions  |

---

## 2. Terminology & Definitions

| Term                   | Definition                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Requisition Header** | Parent entity representing a staffing request with budget and approval metadata |
| **Requisition Item**   | Child entity representing a single position to be filled                        |
| **Transition**         | A permitted change from one state to another                                    |
| **Terminal State**     | A final state from which no further transitions are permitted                   |
| **Actor**              | The authenticated user performing a transition                                  |
| **System-Controlled**  | Transition performed automatically by business logic, not user action           |
| **Manual-Controlled**  | Transition performed explicitly by an authorized user                           |
| **Reopen**             | Transition from a terminal state back to an active state (DISABLED by default)  |

---

## 3. Requisition Header Lifecycle

### 3.1 Header States

| State          | Code             | Type         | Description                                 |
| -------------- | ---------------- | ------------ | ------------------------------------------- |
| Draft          | `DRAFT`          | Initial      | Requisition created but not submitted       |
| Pending Budget | `PENDING_BUDGET` | Intermediate | Submitted, awaiting budget/manager approval |
| Pending HR     | `PENDING_HR`     | Intermediate | Budget approved, awaiting HR approval       |
| Active         | `ACTIVE`         | Working      | Fully approved, TA work in progress         |
| Fulfilled      | `FULFILLED`      | Terminal     | All items fulfilled                         |
| Rejected       | `REJECTED`       | Terminal     | Rejected during approval                    |
| Cancelled      | `CANCELLED`      | Terminal     | Cancelled by authorized actor               |

### 3.2 Header State Transition Matrix

| From State       | To State         | Trigger Type | Authorized Roles   | Description                  |
| ---------------- | ---------------- | ------------ | ------------------ | ---------------------------- |
| `DRAFT`          | `PENDING_BUDGET` | Manual       | MANAGER            | Manager submits for approval |
| `DRAFT`          | `CANCELLED`      | Manual       | MANAGER, ADMIN     | Cancel before submission     |
| `PENDING_BUDGET` | `PENDING_HR`     | Manual       | MANAGER, ADMIN     | Budget approved              |
| `PENDING_BUDGET` | `REJECTED`       | Manual       | MANAGER, ADMIN     | Budget rejected              |
| `PENDING_BUDGET` | `CANCELLED`      | Manual       | MANAGER, ADMIN     | Cancel during budget review  |
| `PENDING_HR`     | `ACTIVE`         | Manual       | HR, ADMIN          | HR approves requisition      |
| `PENDING_HR`     | `REJECTED`       | Manual       | HR, ADMIN          | HR rejects requisition       |
| `PENDING_HR`     | `CANCELLED`      | Manual       | MANAGER, HR, ADMIN | Cancel during HR review      |
| `ACTIVE`         | `FULFILLED`      | System       | SYSTEM             | All items reach FULFILLED    |
| `ACTIVE`         | `CANCELLED`      | Manual       | MANAGER, HR, ADMIN | Cancel active requisition    |

### 3.3 Header State Diagram

```
                                    ┌──────────────┐
                                    │   REJECTED   │ (Terminal)
                                    └──────────────┘
                                           ▲
                                           │ reject
                           ┌───────────────┼───────────────┐
                           │               │               │
┌────────┐  submit   ┌─────┴──────┐ approve ┌──────┴───┐ approve ┌────────┐
│ DRAFT  │──────────▶│PENDING_    │────────▶│PENDING_  │────────▶│ ACTIVE │
│        │           │BUDGET      │         │HR        │         │        │
└────────┘           └────────────┘         └──────────┘         └────────┘
    │                      │                      │                   │
    │ cancel               │ cancel               │ cancel            │ cancel
    ▼                      ▼                      ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            CANCELLED (Terminal)                          │
└──────────────────────────────────────────────────────────────────────────┘

                                                                      │
                                                         all_fulfilled│(system)
                                                                      ▼
                                                              ┌───────────┐
                                                              │ FULFILLED │ (Terminal)
                                                              └───────────┘
```

### 3.4 Header Terminal States

| Terminal State | Reopen Allowed | System Override             |
| -------------- | -------------- | --------------------------- |
| `FULFILLED`    | NO             | Admin audit correction only |
| `REJECTED`     | NO             | Admin audit correction only |
| `CANCELLED`    | NO             | Admin audit correction only |

---

## 4. Requisition Item Lifecycle

### 4.1 Item States

| State        | Code           | Type     | Description                               |
| ------------ | -------------- | -------- | ----------------------------------------- |
| Pending      | `PENDING`      | Initial  | Item created, awaiting TA assignment      |
| Sourcing     | `SOURCING`     | Working  | TA assigned, candidate search in progress |
| Shortlisted  | `SHORTLISTED`  | Working  | Candidates identified for review          |
| Interviewing | `INTERVIEWING` | Working  | Interview process active                  |
| Offered      | `OFFERED`      | Working  | Offer extended to candidate               |
| Fulfilled    | `FULFILLED`    | Terminal | Position filled, employee assigned        |
| Cancelled    | `CANCELLED`    | Terminal | Item cancelled                            |

### 4.2 Item State Transition Matrix

| From State     | To State       | Trigger Type | Authorized Roles       | Prerequisites                            |
| -------------- | -------------- | ------------ | ---------------------- | ---------------------------------------- |
| `PENDING`      | `SOURCING`     | System       | SYSTEM                 | TA assigned to item                      |
| `PENDING`      | `CANCELLED`    | Manual       | MANAGER, HR, ADMIN     | Header not FULFILLED                     |
| `SOURCING`     | `SHORTLISTED`  | Manual       | TA, ADMIN              | At least 1 candidate                     |
| `SOURCING`     | `CANCELLED`    | Manual       | MANAGER, HR, TA, ADMIN | —                                        |
| `SHORTLISTED`  | `INTERVIEWING` | Manual       | TA, ADMIN              | Interview scheduled                      |
| `SHORTLISTED`  | `SOURCING`     | Manual       | TA, ADMIN              | Re-source (no candidates viable)         |
| `SHORTLISTED`  | `CANCELLED`    | Manual       | MANAGER, HR, TA, ADMIN | —                                        |
| `INTERVIEWING` | `OFFERED`      | Manual       | TA, HR, ADMIN          | Interview completed, candidate selected  |
| `INTERVIEWING` | `SHORTLISTED`  | Manual       | TA, ADMIN              | Return to shortlist (candidate rejected) |
| `INTERVIEWING` | `CANCELLED`    | Manual       | MANAGER, HR, TA, ADMIN | —                                        |
| `OFFERED`      | `FULFILLED`    | Manual       | HR, ADMIN              | Offer accepted, employee_id assigned     |
| `OFFERED`      | `INTERVIEWING` | Manual       | TA, HR, ADMIN          | Offer declined, retry                    |
| `OFFERED`      | `CANCELLED`    | Manual       | MANAGER, HR, TA, ADMIN | —                                        |

### 4.3 Item State Diagram

```
┌─────────┐   TA_assigned   ┌──────────┐   shortlist   ┌─────────────┐
│ PENDING │────────────────▶│ SOURCING │──────────────▶│ SHORTLISTED │
└─────────┘    (system)     └──────────┘               └─────────────┘
     │                            │                      │         ▲
     │ cancel                     │ cancel               │         │ re-source
     ▼                            ▼                      │         │
┌─────────────────────────────────────────────┐          ▼         │
│              CANCELLED (Terminal)           │    ┌──────────────────────┐
└─────────────────────────────────────────────┘    │    INTERVIEWING      │
                                                   └──────────────────────┘
                                                         │         ▲
                                                         │         │ retry
                                                   offer ▼         │
                                                   ┌───────────┐   │
                                                   │  OFFERED  │───┘
                                                   └───────────┘
                                                         │
                                                         │ accept + employee_assigned
                                                         ▼
                                                   ┌───────────┐
                                                   │ FULFILLED │ (Terminal)
                                                   └───────────┘
```

### 4.4 Item Terminal States

| Terminal State | Reopen Allowed | System Override             |
| -------------- | -------------- | --------------------------- |
| `FULFILLED`    | NO             | Admin audit correction only |
| `CANCELLED`    | NO             | Admin audit correction only |

### 4.5 Allowed Backward Transitions (Limited Re-work)

| Transition                     | Justification                           | Constraint                |
| ------------------------------ | --------------------------------------- | ------------------------- |
| `SHORTLISTED` → `SOURCING`     | No viable candidates, need fresh search | Must clear candidate list |
| `INTERVIEWING` → `SHORTLISTED` | Interview rejection, return to pool     | Log rejection reason      |
| `OFFERED` → `INTERVIEWING`     | Offer declined, try next candidate      | Log decline reason        |

**RULE:** Forward progress is preferred. Backward transitions require documented justification.

---

## 5. Role-Based Transition Authority Matrix

### 5.1 Header Transition Authority

| Transition                  | MANAGER | HR  | TA  | ADMIN  |
| --------------------------- | ------- | --- | --- | ------ |
| DRAFT → PENDING_BUDGET      | ✅      | ❌  | ❌  | ✅     |
| DRAFT → CANCELLED           | ✅      | ❌  | ❌  | ✅     |
| PENDING_BUDGET → PENDING_HR | ✅      | ❌  | ❌  | ✅     |
| PENDING_BUDGET → REJECTED   | ✅      | ❌  | ❌  | ✅     |
| PENDING_BUDGET → CANCELLED  | ✅      | ❌  | ❌  | ✅     |
| PENDING_HR → ACTIVE         | ❌      | ✅  | ❌  | ✅     |
| PENDING_HR → REJECTED       | ❌      | ✅  | ❌  | ✅     |
| PENDING_HR → CANCELLED      | ✅      | ✅  | ❌  | ✅     |
| ACTIVE → CANCELLED          | ✅      | ✅  | ❌  | ✅     |
| ACTIVE → FULFILLED          | ❌      | ❌  | ❌  | SYSTEM |

### 5.2 Item Transition Authority

| Transition                 | MANAGER | HR  | TA  | ADMIN | SYSTEM |
| -------------------------- | ------- | --- | --- | ----- | ------ |
| PENDING → SOURCING         | ❌      | ❌  | ❌  | ❌    | ✅     |
| PENDING → CANCELLED        | ✅      | ✅  | ❌  | ✅    | ❌     |
| SOURCING → SHORTLISTED     | ❌      | ❌  | ✅  | ✅    | ❌     |
| SOURCING → CANCELLED       | ✅      | ✅  | ✅  | ✅    | ❌     |
| SHORTLISTED → INTERVIEWING | ❌      | ❌  | ✅  | ✅    | ❌     |
| SHORTLISTED → SOURCING     | ❌      | ❌  | ✅  | ✅    | ❌     |
| SHORTLISTED → CANCELLED    | ✅      | ✅  | ✅  | ✅    | ❌     |
| INTERVIEWING → OFFERED     | ❌      | ✅  | ✅  | ✅    | ❌     |
| INTERVIEWING → SHORTLISTED | ❌      | ❌  | ✅  | ✅    | ❌     |
| INTERVIEWING → CANCELLED   | ✅      | ✅  | ✅  | ✅    | ❌     |
| OFFERED → FULFILLED        | ❌      | ✅  | ❌  | ✅    | ❌     |
| OFFERED → INTERVIEWING     | ❌      | ✅  | ✅  | ✅    | ❌     |
| OFFERED → CANCELLED        | ✅      | ✅  | ✅  | ✅    | ❌     |

### 5.3 Field-Level Edit Authority

| Entity | Field                | MANAGER           | HR  | TA  | ADMIN |
| ------ | -------------------- | ----------------- | --- | --- | ----- |
| Header | title, description   | ✅ (DRAFT only)   | ❌  | ❌  | ✅    |
| Header | overall_status       | ❌                | ❌  | ❌  | ❌    |
| Header | priority             | ✅ (DRAFT only)   | ✅  | ❌  | ✅    |
| Header | department_id        | ✅ (DRAFT only)   | ❌  | ❌  | ✅    |
| Header | budget\_\* fields    | ❌                | ❌  | ❌  | ❌    |
| Header | hr\_\* fields        | ❌                | ❌  | ❌  | ❌    |
| Item   | skill_id, qty, etc.  | ✅ (PENDING only) | ❌  | ❌  | ✅    |
| Item   | item_status          | ❌                | ❌  | ❌  | ❌    |
| Item   | assigned_ta          | ❌                | ✅  | ❌  | ✅    |
| Item   | assigned_employee_id | ❌                | ✅  | ❌  | ✅    |
| Item   | sourcing_notes       | ❌                | ❌  | ✅  | ✅    |

**RULE:** `*_status` fields are NEVER directly editable. All status changes go through workflow engine.

---

## 6. Header-Item Synchronization Rules

### 6.1 Automatic Header Status Calculation

The header `overall_status` is recalculated based on item states when:

- Any item status changes
- An item is added or removed
- TA assignment changes

### 6.2 Synchronization Logic

```
FUNCTION calculate_header_status(header):
    items = header.items (excluding soft-deleted)

    IF header.overall_status IN [DRAFT, PENDING_BUDGET, PENDING_HR, REJECTED, CANCELLED]:
        RETURN header.overall_status  # Approval states not affected by items

    IF header.overall_status == ACTIVE:
        active_items = items WHERE item_status NOT IN [FULFILLED, CANCELLED]
        fulfilled_items = items WHERE item_status == FULFILLED
        cancelled_items = items WHERE item_status == CANCELLED

        IF count(items) == 0:
            RETURN CANCELLED  # No items = auto-cancel

        IF count(active_items) == 0 AND count(fulfilled_items) > 0:
            RETURN FULFILLED  # All done

        IF count(active_items) == 0 AND count(fulfilled_items) == 0:
            RETURN CANCELLED  # All cancelled

        RETURN ACTIVE  # Work in progress
```

### 6.3 Synchronization Rules Table

| Header State | Item Event                   | Resulting Header State | Condition                                              |
| ------------ | ---------------------------- | ---------------------- | ------------------------------------------------------ |
| ACTIVE       | Last active item → FULFILLED | FULFILLED              | All items FULFILLED or CANCELLED, at least 1 FULFILLED |
| ACTIVE       | Last active item → CANCELLED | CANCELLED              | All items CANCELLED, none FULFILLED                    |
| ACTIVE       | Any item → CANCELLED         | ACTIVE                 | Other active items remain                              |
| DRAFT        | Item added                   | DRAFT                  | No change                                              |
| PENDING\_\*  | Item change                  | PENDING\_\*            | No change (blocked during approval)                    |

### 6.4 Item Modification Constraints by Header State

| Header State   | Add Item | Remove Item | Edit Item   | Change Item Status |
| -------------- | -------- | ----------- | ----------- | ------------------ |
| DRAFT          | ✅       | ✅          | ✅          | ❌                 |
| PENDING_BUDGET | ❌       | ❌          | ❌          | ❌                 |
| PENDING_HR     | ❌       | ❌          | ❌          | ❌                 |
| ACTIVE         | ❌\*     | ❌          | Limited\*\* | ✅ (via workflow)  |
| FULFILLED      | ❌       | ❌          | ❌          | ❌                 |
| REJECTED       | ❌       | ❌          | ❌          | ❌                 |
| CANCELLED      | ❌       | ❌          | ❌          | ❌                 |

\* Admin can add items to ACTIVE header with audit justification  
\*\* Only TA-editable fields (sourcing_notes) can be modified

---

## 7. Hard Governance Constraints

### 7.1 Inviolable Rules

| Rule ID | Rule                                              | Enforcement                        |
| ------- | ------------------------------------------------- | ---------------------------------- |
| GC-001  | Status fields cannot be directly edited via API   | API validation + no field exposure |
| GC-002  | Terminal states are irreversible                  | Transition matrix + DB trigger     |
| GC-003  | TA assignment auto-transitions PENDING → SOURCING | Workflow engine                    |
| GC-004  | FULFILLED requires employee_id on item            | CHECK constraint + API validation  |
| GC-005  | Header cannot be FULFILLED if any item is active  | Workflow engine                    |
| GC-006  | Items cannot be modified during approval states   | API validation                     |
| GC-007  | All transitions require audit log entry           | Workflow engine + DB trigger       |
| GC-008  | Only SYSTEM can transition header to FULFILLED    | Workflow engine                    |
| GC-009  | Backward item transitions require justification   | API requires `reason` parameter    |
| GC-010  | Delete operations are soft-delete only            | DB constraint + API enforcement    |

### 7.2 Data Integrity Rules

| Rule ID | Rule                                              | Enforcement                  |
| ------- | ------------------------------------------------- | ---------------------------- |
| DI-001  | Item.assigned_ta must exist in users              | FK constraint                |
| DI-002  | Item.assigned_employee_id must exist in employees | FK constraint                |
| DI-003  | Header.created_by must exist in users             | FK constraint                |
| DI-004  | Item.req_id must exist in requisitions            | FK constraint + RESTRICT     |
| DI-005  | Header with active items cannot be deleted        | FK RESTRICT + workflow check |
| DI-006  | Employee can only be assigned to one active item  | Unique partial index         |
| DI-007  | TA can have max N concurrent items (configurable) | Application constraint       |

### 7.3 Temporal Constraints

| Rule ID | Rule                                           | Enforcement          |
| ------- | ---------------------------------------------- | -------------------- |
| TC-001  | created_at is immutable                        | DB trigger           |
| TC-002  | updated_at auto-updates on any change          | DB trigger / ORM     |
| TC-003  | Status history preserves full transition chain | Append-only table    |
| TC-004  | Audit log entries cannot be modified           | No UPDATE permission |

---

## 8. Database Enforcement Strategy

### 8.1 Status Constraints

```sql
-- Header Status Constraint
ALTER TABLE requisitions
ADD CONSTRAINT chk_requisition_status
CHECK (overall_status IN (
    'Draft', 'Pending_Budget', 'Pending_HR', 'Active',
    'Fulfilled', 'Rejected', 'Cancelled'
));

-- Item Status Constraint
ALTER TABLE requisition_items
ADD CONSTRAINT chk_item_status
CHECK (item_status IN (
    'Pending', 'Sourcing', 'Shortlisted', 'Interviewing',
    'Offered', 'Fulfilled', 'Cancelled'
));
```

### 8.2 Foreign Key Constraints

```sql
-- Items reference header with RESTRICT (prevent orphan cascade)
ALTER TABLE requisition_items
ADD CONSTRAINT fk_item_requisition
FOREIGN KEY (req_id) REFERENCES requisitions(id)
ON DELETE RESTRICT ON UPDATE CASCADE;

-- TA assignment with RESTRICT
ALTER TABLE requisition_items
ADD CONSTRAINT fk_item_ta
FOREIGN KEY (assigned_ta) REFERENCES users(id)
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Employee assignment with RESTRICT
ALTER TABLE requisition_items
ADD CONSTRAINT fk_item_employee
FOREIGN KEY (assigned_employee_id) REFERENCES employees(id)
ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 8.3 Partial Unique Indexes

```sql
-- Prevent same employee assigned to multiple active items
CREATE UNIQUE INDEX idx_unique_active_employee
ON requisition_items (assigned_employee_id)
WHERE item_status NOT IN ('Fulfilled', 'Cancelled')
AND assigned_employee_id IS NOT NULL;
```

### 8.4 Fulfillment Constraint

```sql
-- FULFILLED items must have employee assigned
ALTER TABLE requisition_items
ADD CONSTRAINT chk_fulfilled_has_employee
CHECK (
    item_status != 'Fulfilled'
    OR assigned_employee_id IS NOT NULL
);
```

### 8.5 Status Indexes for Query Performance

```sql
CREATE INDEX idx_requisitions_status ON requisitions(overall_status);
CREATE INDEX idx_requisition_items_status ON requisition_items(item_status);
CREATE INDEX idx_requisition_items_ta ON requisition_items(assigned_ta);
CREATE INDEX idx_requisition_items_req ON requisition_items(req_id);
```

### 8.6 Audit Trigger (Status History)

```sql
CREATE OR REPLACE FUNCTION log_item_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.item_status IS DISTINCT FROM NEW.item_status THEN
        INSERT INTO requisition_status_history (
            item_id, prev_status, new_status, changed_at, changed_by
        ) VALUES (
            NEW.id, OLD.item_status, NEW.item_status, NOW(),
            current_setting('app.current_user_id', true)::int
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_status_audit
AFTER UPDATE ON requisition_items
FOR EACH ROW EXECUTE FUNCTION log_item_status_change();
```

---

## 9. API Validation Strategy

### 9.1 Transition Endpoint Design

```
POST /api/requisitions/{id}/workflow/{action}
POST /api/requisition-items/{id}/workflow/{action}
```

**NOT:**

```
PATCH /api/requisitions/{id}  (with status in body) ❌
```

### 9.2 Valid Header Actions

| Action         | Endpoint                                            | Required Params | Roles              |
| -------------- | --------------------------------------------------- | --------------- | ------------------ |
| submit         | POST /api/requisitions/{id}/workflow/submit         | —               | MANAGER            |
| approve_budget | POST /api/requisitions/{id}/workflow/approve-budget | —               | MANAGER, ADMIN     |
| approve_hr     | POST /api/requisitions/{id}/workflow/approve-hr     | —               | HR, ADMIN          |
| reject         | POST /api/requisitions/{id}/workflow/reject         | reason          | MANAGER, HR, ADMIN |
| cancel         | POST /api/requisitions/{id}/workflow/cancel         | reason          | MANAGER, HR, ADMIN |

### 9.3 Valid Item Actions

| Action              | Endpoint                                                   | Required Params             | Roles         |
| ------------------- | ---------------------------------------------------------- | --------------------------- | ------------- |
| assign_ta           | POST /api/requisition-items/{id}/workflow/assign-ta        | ta_user_id                  | HR, ADMIN     |
| shortlist           | POST /api/requisition-items/{id}/workflow/shortlist        | candidate_count             | TA, ADMIN     |
| start_interview     | POST /api/requisition-items/{id}/workflow/start-interview  | —                           | TA, ADMIN     |
| make_offer          | POST /api/requisition-items/{id}/workflow/make-offer       | candidate_id, offer_details | TA, HR, ADMIN |
| fulfill             | POST /api/requisition-items/{id}/workflow/fulfill          | employee_id                 | HR, ADMIN     |
| re_source           | POST /api/requisition-items/{id}/workflow/re-source        | reason                      | TA, ADMIN     |
| return_to_shortlist | POST /api/requisition-items/{id}/workflow/return-shortlist | reason                      | TA, ADMIN     |
| cancel              | POST /api/requisition-items/{id}/workflow/cancel           | reason                      | \*            |

### 9.4 Request Validation Schema

```python
class WorkflowTransitionRequest(BaseModel):
    action: str
    reason: Optional[str] = None  # Required for reject, cancel, backward transitions
    params: Optional[dict] = None  # Action-specific parameters

    @validator('reason')
    def reason_required_for_actions(cls, v, values):
        if values.get('action') in ['reject', 'cancel', 're_source', 'return_shortlist']:
            if not v or len(v.strip()) < 10:
                raise ValueError('Reason required (min 10 chars) for this action')
        return v
```

### 9.5 Response Schema

```python
class WorkflowTransitionResponse(BaseModel):
    success: bool
    entity_id: int
    entity_type: Literal['requisition', 'requisition_item']
    previous_status: str
    new_status: str
    transitioned_at: datetime
    transitioned_by: int
    audit_log_id: int
```

### 9.6 Error Response Codes

| HTTP Code | Error Type              | Description                                         |
| --------- | ----------------------- | --------------------------------------------------- |
| 400       | INVALID_TRANSITION      | Requested transition not allowed from current state |
| 403       | UNAUTHORIZED_TRANSITION | User role not authorized for this transition        |
| 409       | CONFLICT                | Concurrent modification detected (optimistic lock)  |
| 422       | VALIDATION_ERROR        | Missing required parameters                         |
| 423       | LOCKED                  | Entity is locked for modification                   |

### 9.7 Blocked Fields in PATCH Endpoints

The following fields **MUST** be stripped from any PATCH request body:

**Requisitions:**

- `overall_status`
- `budget_approved_at`, `budget_approved_by`
- `hr_approved_at`, `hr_approved_by`
- `created_at`, `created_by`

**Requisition Items:**

- `item_status`
- `assigned_employee_id` (only via workflow/fulfill)
- `created_at`

---

## 10. Edge Case Handling

### 10.1 Race Conditions

| Scenario                                | Handling                                |
| --------------------------------------- | --------------------------------------- |
| Two users approve same header           | Optimistic locking with version column  |
| TA assigned while item cancelled        | Row-level lock with `SELECT FOR UPDATE` |
| Header cancelled while item in progress | Cancel cascades to active items         |

### 10.2 Bulk Operations

| Operation               | Rule                                                 |
| ----------------------- | ---------------------------------------------------- |
| Bulk assign TA to items | Transaction; all-or-nothing                          |
| Bulk cancel items       | Individual item rules apply; partial success allowed |
| Bulk status change      | NOT PERMITTED via API                                |

### 10.3 Orphan Prevention

| Scenario                        | Rule                                  |
| ------------------------------- | ------------------------------------- |
| Delete header with items        | BLOCKED (FK RESTRICT)                 |
| Remove last item from header    | Auto-cancel header if ACTIVE          |
| Delete TA user with assignments | BLOCKED (FK RESTRICT); reassign first |

### 10.4 Retroactive Changes

| Scenario                          | Rule                              |
| --------------------------------- | --------------------------------- |
| Edit fulfilled item               | BLOCKED; create correction record |
| Change employee on fulfilled item | BLOCKED; requires HR escalation   |
| Modify historical audit logs      | BLOCKED; no UPDATE permission     |

### 10.5 System Recovery

| Scenario                          | Handling                  |
| --------------------------------- | ------------------------- |
| Transaction rollback mid-workflow | Atomic; no partial state  |
| Audit log write failure           | Fail entire transaction   |
| Notification failure              | Non-blocking; retry queue |

---

## 11. Audit Requirements

### 11.1 Mandatory Audit Fields

Every audit log entry **MUST** contain:

| Field        | Type      | Description                         |
| ------------ | --------- | ----------------------------------- |
| id           | SERIAL    | Primary key                         |
| entity_type  | VARCHAR   | 'requisition' or 'requisition_item' |
| entity_id    | INTEGER   | ID of affected entity               |
| action       | VARCHAR   | Transition action performed         |
| prev_status  | VARCHAR   | Status before transition            |
| new_status   | VARCHAR   | Status after transition             |
| performed_by | INTEGER   | User ID of actor                    |
| performed_at | TIMESTAMP | Transition timestamp (UTC)          |
| ip_address   | VARCHAR   | Client IP address                   |
| user_agent   | VARCHAR   | Client user agent                   |
| reason       | TEXT      | Justification (if required)         |
| metadata     | JSONB     | Additional context                  |

### 11.2 Audit Retention

| Requirement       | Value                              |
| ----------------- | ---------------------------------- |
| Minimum retention | 7 years                            |
| Archive strategy  | Move to cold storage after 2 years |
| Deletion policy   | NEVER delete; archive only         |

### 11.3 Audit Query Endpoints

```
GET /api/audit/requisitions/{id}         # Header audit trail
GET /api/audit/requisition-items/{id}    # Item audit trail
GET /api/audit/user/{user_id}            # User activity log
GET /api/audit/search                     # Search with filters
```

---

## 12. Implementation Checklist

### 12.1 Database Layer

- [ ] Create/update CHECK constraints for header status
- [ ] Create/update CHECK constraints for item status
- [ ] Add FK constraints with ON DELETE RESTRICT
- [ ] Create partial unique index for active employee assignment
- [ ] Add fulfillment constraint (FULFILLED → employee required)
- [ ] Create status indexes
- [ ] Implement audit trigger for item status changes
- [ ] Add version column for optimistic locking

### 12.2 Service Layer

- [ ] Implement `RequisitionWorkflowEngine` class
- [ ] Implement header transition methods
- [ ] Implement item transition methods
- [ ] Implement header-item synchronization logic
- [ ] Implement role-based permission checks
- [ ] Implement optimistic locking
- [ ] Implement row-level locking for concurrent access
- [ ] Implement audit log writer

### 12.3 API Layer

- [ ] Create workflow action endpoints for headers
- [ ] Create workflow action endpoints for items
- [ ] Implement field stripping for PATCH endpoints
- [ ] Add request validation for required parameters
- [ ] Implement proper error responses
- [ ] Add rate limiting for workflow endpoints

### 12.4 Testing

- [ ] Unit tests for each transition
- [ ] Unit tests for permission matrix
- [ ] Integration tests for synchronization
- [ ] Concurrent access tests
- [ ] Audit log integrity tests

---

## Appendix A: State Code Reference

### Header States (Enum)

```python
class RequisitionStatus(str, Enum):
    DRAFT = "Draft"
    PENDING_BUDGET = "Pending_Budget"
    PENDING_HR = "Pending_HR"
    ACTIVE = "Active"
    FULFILLED = "Fulfilled"
    REJECTED = "Rejected"
    CANCELLED = "Cancelled"
```

### Item States (Enum)

```python
class RequisitionItemStatus(str, Enum):
    PENDING = "Pending"
    SOURCING = "Sourcing"
    SHORTLISTED = "Shortlisted"
    INTERVIEWING = "Interviewing"
    OFFERED = "Offered"
    FULFILLED = "Fulfilled"
    CANCELLED = "Cancelled"
```

---

## Appendix B: Allowed Transitions Quick Reference

### Header Transitions

```
DRAFT           → PENDING_BUDGET, CANCELLED
PENDING_BUDGET  → PENDING_HR, REJECTED, CANCELLED
PENDING_HR      → ACTIVE, REJECTED, CANCELLED
ACTIVE          → FULFILLED (system), CANCELLED
FULFILLED       → (terminal)
REJECTED        → (terminal)
CANCELLED       → (terminal)
```

### Item Transitions

```
PENDING      → SOURCING (system), CANCELLED
SOURCING     → SHORTLISTED, CANCELLED
SHORTLISTED  → INTERVIEWING, SOURCING, CANCELLED
INTERVIEWING → OFFERED, SHORTLISTED, CANCELLED
OFFERED      → FULFILLED, INTERVIEWING, CANCELLED
FULFILLED    → (terminal)
CANCELLED    → (terminal)
```

---

## Document Control

| Version | Date       | Author           | Changes                        |
| ------- | ---------- | ---------------- | ------------------------------ |
| 1.0.0   | 2026-02-05 | System Architect | Initial approved specification |

---

**END OF SPECIFICATION**
