# RBM Resource Fulfillment Platform - Workflow, Architecture, and Feature Guide

## 1. Purpose

This document describes the implemented platform architecture and end-to-end workflows across:

- Frontend (`rbm-rfm-frontend`)
- Backend (`backend`)
- Core business domains: requisitions, item workflow, budget approvals, TA operations, candidates/interviews, projects, employees/HR, audit, and authentication.

---

## 2. System Overview

RBM Resource Fulfillment Module is a role-based staffing and resource management platform built as a **modular monolith**:

- **Frontend:** React + TypeScript + Vite SPA
- **Backend:** FastAPI + SQLAlchemy + Pydantic
- **Database:** PostgreSQL with Alembic migrations
- **Auth:** JWT bearer tokens + RBAC
- **Primary model:** Requisition header with multi-item fulfillment workflow

### 2.1 High-Level Architecture

```text
[React SPA]
  - Role dashboards (Manager, HR, TA, Admin, Owner)
  - Workflow-driven actions
  - Axios client with JWT interceptor
            |
            v
[FastAPI Backend]
  - Domain routers under /api/*
  - Workflow routes for status transitions
  - Service layer (workflow engine, resume/JD parsing, recommendations)
  - RBAC dependencies + TA ownership checks
            |
            v
[PostgreSQL]
  - Users/Roles, Employees, Skills
  - Requisitions + Requisition Items
  - Candidates/Interviews/Candidate Pool
  - Projects/Assignments
  - Audit and workflow history tables
```

---

## 3. Backend Architecture

## 3.1 Entry Point and Router Composition

Backend entrypoint: `backend/main.py`

Responsibilities:

- Initializes FastAPI app
- Configures CORS
- Adds DB exception handlers
- Registers status-protection hooks for requisition status fields
- Mounts all domain routers

Key router families mounted:

- Auth, users, org/master data
- Employees and employee sub-resources
- Skills
- Requisitions and requisition items
- Workflow routes (`/requisitions/{id}/workflow/*`, `/requisition-items/{id}/workflow/*`)
- Workflow audit/metrics
- Dashboard APIs
- Candidates, interviews, candidate intake, candidate pool
- Resume parsing and TA resume screening
- Projects and resource assignments

Implementation note:

- `projects.router` is mounted both with `/api` prefix and once without prefix in `main.py`, so project endpoints are reachable via both `/api/projects/*` and `/projects/*`.

## 3.2 Layering Pattern

The backend follows this path for core business operations:

1. API router validates request + role gate
2. Workflow/service layer executes business rules
3. SQLAlchemy models persist state
4. Audit/status history records are written in the same transaction
5. API response serialized via Pydantic schemas

## 3.3 Workflow Engine (Authoritative State Machine)

Core files:

- `backend/services/requisition/workflow_engine_v2.py`
- `backend/services/requisition/workflow_matrix.py`
- `backend/api/workflow_routes.py`
- `backend/services/requisition/status_protection.py`

Enforcement model:

- No direct status mutation via generic PATCH endpoints
- Transitions must pass matrix validation
- Role authorization checked per transition
- Terminal state protections
- Backward transitions require reason
- System-only transitions (for specific transitions)
- Pessimistic locking (`SELECT ... FOR UPDATE`) + optimistic version checks
- Audit writes are mandatory; failure rolls back transaction

## 3.4 Data Model Domains

Core model groups (`backend/db/models`):

- **Auth/RBAC:** `User`, `Role`, `UserRole`, `UserEmployeeMap`
- **Employee domain:** employee core + contacts, skills, education, finance, availability, assignments
- **Requisition domain:** requisition header, requisition items, status history, workflow audit
- **Candidate domain:** candidate, interview, intake submissions, profiles, resumes, requisition candidate pool/ranking snapshots
- **Project domain:** project, project managers, timelines, employee project assignments
- **Observability:** `AuditLog`, `WorkflowTransitionAudit`

## 3.5 Security and Access Control

Core access features:

- JWT verification dependency (`utils/dependencies.py`)
- Role checks (`require_role`, `require_any_role`)
- TA ownership enforcement for candidate and item operations
- Active-user checks and account status checks

## 3.6 File and Document Handling

- JD upload/download at requisition and item levels
- Resume upload endpoints
- Storage abstraction (`utils/storage.py`) supporting local/S3-style modes
- File validations (type/size), especially PDF limits for JD files

---

## 4. Frontend Architecture

## 4.1 Routing and Role Areas

Main router: `rbm-rfm-frontend/src/routes/AppRouter.tsx`

Role-based route partitions:

- `/admin/*`: admin dashboard, master data, users, audit logs, projects
- `/owner/*`: executive and cross-functional monitoring views + projects
- `/hr/*`: HR dashboard, approvals, employee management, requisitions, projects
- `/ta/*`: TA dashboard, requisitions, resource pool, resume screening, projects
- `/manager/*`: manager dashboard, wizard, requisition details/audit, projects

Protection:

- `ProtectedRoute` checks auth + required role(s)
- Unauthorized users redirected to `/unauthorized`

## 4.2 Auth State and Session Handling

Core file: `src/contexts/AuthContext.tsx`

Features:

- Login against `/auth/login`
- Stores JWT in `localStorage`
- Parses token payload for user identity + roles
- Normalizes roles to lowercase in frontend state
- Exposes `login`, `logout`, loading/error state

## 4.3 API Integration Pattern

Core file: `src/api/client.ts`

- Shared Axios client using `VITE_API_BASE_URL`
- Request interceptor auto-attaches `Authorization: Bearer <token>`

Domain API modules:

- `workflowApi.ts`: requisition/item workflow transition endpoints
- `projectService.ts`: projects, timelines, assignments, skill search/recommendations
- `candidateApi.ts`: candidates, interviews, resume upload
- `hrDashboardService.ts`, `managerDashboardService.ts`
- `employeeService.ts`, `users.ts`, `auditApi.ts`

## 4.4 UI Module Structure

Component namespaces under `src/components`:

- `admin`, `owner`, `hr`, `manager`, `ta`, `project`, `workflow`, `audit`, `common`, `ui`, `shared`

The UI is organized as role dashboards with nested functional panels rather than one global generic dashboard.

---

## 5. Core Platform Workflows

## 5.1 Requisition Header Lifecycle

Canonical states (V2 workflow matrix):

- `Draft`
- `Pending_Budget`
- `Pending_HR`
- `Active`
- `Fulfilled`
- `Rejected`
- `Cancelled`

Current transition behavior:

- `Draft -> Pending_Budget` (submit)
- `Pending_Budget -> Pending_HR` (budget approval)
- `Pending_HR -> Active` (HR approval)
- `Active -> Fulfilled` (system-driven when items complete)
- Cancellation and rejection paths as permitted by matrix
- Reopen path implemented: `Rejected -> Draft` (revision/resubmission)

## 5.2 Requisition Item Lifecycle

Canonical states:

- `Pending`
- `Sourcing`
- `Shortlisted`
- `Interviewing`
- `Offered`
- `Fulfilled`
- `Cancelled`

Key behavior:

- TA assignment can auto-progress `Pending -> Sourcing`
- Backward transitions implemented with mandatory reasons:
  - `Shortlisted -> Sourcing`
  - `Interviewing -> Shortlisted`
  - `Offered -> Interviewing`
- Fulfillment requires employee assignment through workflow route

## 5.3 Item Budget Workflow (Item-level Budget Architecture)

Implemented actions:

- Edit item estimated budget
- Approve item budget (optionally with approved amount override)
- Reject item budget (requires reason)

Header synchronization rule:

- When all item budgets are approved, header transitions from `Pending_Budget` to `Pending_HR`

## 5.4 TA Assignment and Reassignment

Supported patterns:

- Header-level TA assignment with propagation to items
- Item-level TA assignment
- Single-item reassignment (`/requisition-items/{item_id}/reassign`)
- Bulk reassignment by requisition (`/requisitions/{req_id}/bulk-reassign`)

## 5.5 Candidate and Interview Pipeline

Capabilities:

- Candidate CRUD under requisition item context
- Candidate stage transitions
- Interview scheduling, updating, deletion
- TA ownership checks to prevent cross-TA unauthorized edits

## 5.6 Candidate Intake + Requisition Candidate Pool

Features include:

- Resume parse-preview and apply flows
- Candidate profile and resume retrieval
- Attach/detach profiles to requisition candidate pool
- Pipeline stage progression and ranking snapshots
- Candidate pool ranking APIs and test UIs

## 5.7 TA Resume Screening (JD-based Ranking)

Frontend module: `components/ta/ResumeScreening.tsx`  
Backend module: `api/ta_resume_screening.py` + `services/ta_resume_screening.py`

Flow:

1. Upload resumes and create screening job
2. Parse JD and infer title/domain/skills/experience bounds
3. Start JD-based processing
4. Poll job results
5. Render ranked candidates with skill-level score breakdown

Technical characteristics:

- In-memory job orchestration with locks
- Skill taxonomy + alias normalization
- Evidence extraction from resume sections
- Candidate scoring and ranking output with debugging metadata

## 5.8 Employee and HR Lifecycle

HR capabilities:

- Multi-step employee creation/onboarding
- Employee profile management (core, contact, education, skills, finance)
- Employee status updates and onboarding completion
- HR dashboard metrics and pending approval panels

## 5.9 Project and Resource Management Workflow

Project module supports:

- Project CRUD
- Project approval status updates
- Project manager mappings
- Timeline entries
- Employee project assignments + assignment approval states
- Skill-based employee search for a project
- Optional AI-assisted skill recommendations (`skill_ai_reranker`)

Role scope includes manager-specific approval visibility based on assignment.

---

## 6. Role-Based Functional View (Frontend + Backend)

## 6.1 Manager

- Raise requisitions via 3-step wizard
- Add multiple positions/items per requisition
- Upload item-level JD files
- Track own requisitions and requisition-specific alerts/SLA risk indicators
- Access project views and manager approvals where eligible

## 6.2 HR

- Budget and HR approvals
- Item budget approval panel
- Requisition review and TA assignment/reassignment
- Employee creation and profile governance
- HR metrics dashboard and pending approvals

## 6.3 TA

- Access assigned requisitions/items
- Work item pipeline transitions (shortlist, interview, offer, fulfill/cancel)
- Manage candidates/interviews
- Use resource pool and resume screening modules
- Receive TA reassignment and item assignment notifications

## 6.4 Admin

- User and role administration
- Master data management (skills, departments, locations, roles)
- Global audit log review
- Broad project administration access

## 6.5 Owner

- Executive summary views (resource utilization, requisition overview, TA/HR performance, audit/approvals)
- Access to project dashboards with wide visibility

---

## 7. Observability, Audit, and Governance

Audit layers:

- General `audit_log` entries for business operations
- Workflow-specific `workflow_transition_audit`
- Requisition status history records
- Workflow metrics/health endpoints

Governance patterns:

- Status field protection hooks block direct mutation paths
- Workflow endpoints are explicit action endpoints (not generic status patch)
- Transition authorization matrix defines who can do what
- Mandatory reason validation for reject/cancel/backward transitions

---

## 8. Key API Surface by Domain

Representative endpoint groups (not exhaustive):

- `/api/auth/*` - login/token issuance
- `/api/requisitions/*` - requisition CRUD, listing, JD operations
- `/api/requisitions/{req_id}/workflow/*` - header workflow actions
- `/api/requisition-items/{item_id}/workflow/*` - item workflow + budget actions
- `/api/requisition-items/{item_id}/reassign` and `/api/requisitions/{req_id}/bulk-reassign`
- `/api/candidates/*`, `/api/interviews/*`
- `/api/requisitions/{req_id}/candidate-pool/*`
- `/api/candidate-intake/*`
- `/api/ta/*` - TA resume screening jobs
- `/api/projects/*` - projects, timelines, assignments, approvals, skill search/recommendations
- `/api/dashboard/*` - manager and HR dashboard metrics
- `/api/audit/*` and `/api/workflow-audit/*` - audit and workflow observability

---

## 9. Testing and Validation Coverage

Backend tests include focused suites for:

- Workflow engine logic
- Workflow integration and concurrency
- Requisition creation and budget/item workflow
- Project approval workflow
- Project skill matching
- Resume parsing and scoring
- Chaos/concurrency examples

This indicates deliberate coverage around the platform's highest-risk areas: transitions, locking, and scoring logic.

---

## 10. Architectural Strengths and Practical Notes

Strengths:

- Strong workflow governance with centralized state matrix
- Clear role-based split in both API and UI
- Rich domain model supporting end-to-end resource fulfillment
- Good auditability and operational introspection
- Modern full-stack TypeScript/Python separation with shared workflow intent

Implementation notes:

- Legacy statuses still appear in compatibility paths (e.g., `"Approved & Unassigned"` references)
- Project router dual-mount creates both prefixed and non-prefixed project URLs
- Some frontend architecture docs in `src/lib/workflow/ARCHITECTURE.ts` describe older patterns; runtime behavior is backend-driven workflow API

---

## 11. Source Map (Primary Files)

Backend:

- `backend/main.py`
- `backend/api/*.py`
- `backend/services/requisition/*`
- `backend/services/ta_resume_screening.py`
- `backend/services/ta_jd_screening.py`
- `backend/db/models/*`

Frontend:

- `rbm-rfm-frontend/src/routes/AppRouter.tsx`
- `rbm-rfm-frontend/src/contexts/AuthContext.tsx`
- `rbm-rfm-frontend/src/api/*`
- `rbm-rfm-frontend/src/components/{manager,hr,ta,admin,owner,project}/*`

