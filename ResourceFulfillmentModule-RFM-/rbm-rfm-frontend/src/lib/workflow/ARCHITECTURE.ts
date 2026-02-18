/**
 * ============================================================================
 * WORKFLOW ENGINE ARCHITECTURE DOCUMENTATION
 * ============================================================================
 *
 * This document explains the centralized workflow state machine system
 * and provides guidance for integrating it across the application.
 */

/**
 * TABLE OF CONTENTS
 * -----------------
 * 1. Architecture Overview
 * 2. Frontend Module Structure
 * 3. Backend Module Structure
 * 4. Integration Patterns
 * 5. Adding New Workflows
 * 6. Testing Strategy
 * 7. Why This Approach?
 */

// ============================================================================
// 1. ARCHITECTURE OVERVIEW
// ============================================================================

/**
 * The workflow engine provides a declarative state machine that enforces
 * valid status transitions. It is implemented in both frontend (TypeScript)
 * and backend (Python) to ensure consistency.
 *
 * KEY COMPONENTS:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    FRONTEND (TypeScript)                        │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  lib/workflow/engine.ts        - Core Workflow class & guards   │
 * │  lib/workflow/hooks.ts         - React integration hooks        │
 * │  lib/workflow/*.workflow.ts    - Domain-specific definitions    │
 * │  lib/workflow/index.ts         - Public exports                 │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼ (mirrors)
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    BACKEND (Python)                             │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  utils/workflow_engine.py      - Core Workflow class & guards   │
 * │  utils/requisition_workflow.py - Requisition state machine      │
 * │  utils/employee_workflow.py    - Employee lifecycle machine     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * DATA FLOW:
 *
 * ┌──────────┐    validate()    ┌──────────────┐
 * │   UI     │ ───────────────► │  Workflow    │
 * │ Component│                  │  Engine      │
 * └──────────┘                  └──────────────┘
 *      │                              │
 *      │ if allowed                   │ TransitionResult
 *      ▼                              │
 * ┌──────────┐                        │
 * │  API     │ ◄──────────────────────┘
 * │  Call    │
 * └──────────┘
 *      │
 *      ▼
 * ┌──────────┐    validate()    ┌──────────────┐
 * │  FastAPI │ ───────────────► │  Workflow    │
 * │ Endpoint │                  │  Engine      │
 * └──────────┘                  └──────────────┘
 *      │                              │
 *      │ if allowed                   │ WorkflowError if not
 *      ▼                              │
 * ┌──────────┐                        │
 * │ Database │                        │
 * │  Update  │                        │
 * └──────────┘                        │
 */

// ============================================================================
// 2. FRONTEND MODULE STRUCTURE
// ============================================================================

/**
 * FILE: lib/workflow/engine.ts
 * ----------------------------
 * Core workflow engine with generic types.
 *
 * Exports:
 * - Workflow<TStatus, TContext>  - Main workflow class
 * - TransitionResult             - Validation result type
 * - Guard functions              - minLength, required, when, etc.
 *
 * Usage:
 * ```typescript
 * const myWorkflow = new Workflow<MyStatus, MyContext>(
 *   { name: 'My Workflow', version: '1.0.0' },
 *   {
 *     'Status A': {
 *       'Status B': { guards: [someGuard] },
 *     },
 *   }
 * );
 *
 * const result = myWorkflow.validate('Status A', 'Status B', context);
 * if (result.allowed) {
 *   // Proceed with transition
 * } else {
 *   // Show result.error to user
 * }
 * ```
 */

/**
 * FILE: lib/workflow/hooks.ts
 * ---------------------------
 * React hooks for component integration.
 *
 * useWorkflowTransition:
 *   Full state management for transitions with async support.
 *   Use when you need to track pending transitions, show loading states,
 *   and handle API errors.
 *
 * useWorkflowActions:
 *   Generates action button configurations based on current state.
 *   Use for dynamic action menus.
 *
 * useWorkflowValidation:
 *   Lightweight validation check for multiple target statuses.
 *   Use when you just need to enable/disable buttons.
 */

/**
 * FILE: lib/workflow/*.workflow.ts
 * --------------------------------
 * Domain-specific workflow definitions.
 *
 * Each workflow file exports:
 * 1. Status type & constants      - Type-safe status values
 * 2. Context interface            - Required data for validation
 * 3. Workflow instance            - The configured state machine
 * 4. Convenience functions        - canTransition, validate, etc.
 * 5. UI helpers                   - Labels, CSS classes
 */

// ============================================================================
// 3. BACKEND MODULE STRUCTURE
// ============================================================================

/**
 * FILE: utils/workflow_engine.py
 * ------------------------------
 * Python equivalent of the frontend engine.
 *
 * Key differences from TypeScript version:
 * - Uses dataclasses instead of interfaces
 * - Guards are plain functions, not arrow functions
 * - Uses Dict[str, Any] for context typing
 * - Raises WorkflowError instead of returning error results
 */

/**
 * INTEGRATION IN FASTAPI ENDPOINTS:
 *
 * ```python
 * from backend.utils.requisition_workflow import (
 *     validate_requisition_transition,
 *     assert_requisition_transition,
 * )
 * from backend.utils.workflow_engine import WorkflowError
 *
 * @router.put("/{req_id}/reject")
 * def reject_requisition(
 *     req_id: int,
 *     body: RequisitionReject,
 *     db: Session = Depends(get_db),
 *     current_user: User = Depends(get_current_user),
 * ):
 *     requisition = db.query(Requisition).get(req_id)
 *
 *     # Build context
 *     context = {
 *         "user_role": current_user.role.name.lower(),
 *         "rejection_reason": body.reason,
 *     }
 *
 *     # Validate transition
 *     try:
 *         assert_requisition_transition(
 *             requisition.status,
 *             "Rejected",
 *             context
 *         )
 *     except WorkflowError as e:
 *         raise HTTPException(status_code=400, detail=str(e))
 *
 *     # Proceed with update
 *     requisition.status = "Rejected"
 *     requisition.rejection_reason = body.reason
 *     db.commit()
 * ```
 */

// ============================================================================
// 4. INTEGRATION PATTERNS
// ============================================================================

/**
 * PATTERN 1: Simple Button Disabling
 * -----------------------------------
 * Use when you just need to enable/disable action buttons.
 *
 * ```tsx
 * import { validateRequisitionTransition, RequisitionStatus } from '@/lib/workflow';
 *
 * function ApprovalButtons({ requisition, userRole }) {
 *   const context = { userRole };
 *
 *   const canApprove = validateRequisitionTransition(
 *     requisition.status,
 *     'Approved & Unassigned',
 *     context
 *   ).allowed;
 *
 *   return (
 *     <button disabled={!canApprove}>Approve</button>
 *   );
 * }
 * ```
 */

/**
 * PATTERN 2: Modal with Validation
 * ---------------------------------
 * Use when transition requires user input (like rejection reason).
 *
 * ```tsx
 * function RejectModal({ requisition, onReject, onClose }) {
 *   const [reason, setReason] = useState('');
 *
 *   const validation = validateRequisitionTransition(
 *     requisition.status,
 *     'Rejected',
 *     { userRole: 'hr', rejectionReason: reason }
 *   );
 *
 *   return (
 *     <div className="modal">
 *       <textarea
 *         value={reason}
 *         onChange={(e) => setReason(e.target.value)}
 *       />
 *       {validation.error && <p className="error">{validation.error}</p>}
 *       <button
 *         disabled={!validation.allowed}
 *         onClick={() => onReject(reason)}
 *       >
 *         Confirm
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */

/**
 * PATTERN 3: Hook-Based Full Flow
 * --------------------------------
 * Use when you need loading states and API error handling.
 *
 * ```tsx
 * import { useWorkflowTransition, requisitionWorkflow } from '@/lib/workflow';
 *
 * function RequisitionActions({ requisition }) {
 *   const {
 *     canTransitionTo,
 *     executeTransition,
 *     isTransitioning,
 *     validationResult,
 *     apiError,
 *   } = useWorkflowTransition(requisitionWorkflow, requisition.status);
 *
 *   const handleApprove = async () => {
 *     const success = await executeTransition(
 *       'Approved & Unassigned',
 *       { userRole: 'hr' },
 *       () => apiClient.put(`/api/requisitions/${requisition.id}/approve`)
 *     );
 *
 *     if (success) {
 *       toast.success('Requisition approved!');
 *     }
 *   };
 *
 *   return (
 *     <>
 *       {(validationResult?.error || apiError) && (
 *         <Alert type="error">{validationResult?.error || apiError}</Alert>
 *       )}
 *       <button
 *         disabled={!canTransitionTo('Approved & Unassigned') || isTransitioning}
 *         onClick={handleApprove}
 *       >
 *         {isTransitioning ? 'Processing...' : 'Approve'}
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */

/**
 * PATTERN 4: Dynamic Status Dropdown
 * -----------------------------------
 * Use for admin interfaces that allow direct status changes.
 *
 * ```tsx
 * import { getRequisitionNextStatuses } from '@/lib/workflow';
 *
 * function StatusDropdown({ currentStatus, onChange }) {
 *   const availableStatuses = getRequisitionNextStatuses(currentStatus);
 *
 *   return (
 *     <select onChange={(e) => onChange(e.target.value)}>
 *       <option value="">Change status...</option>
 *       {availableStatuses.map(status => (
 *         <option key={status} value={status}>{status}</option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */

// ============================================================================
// 5. ADDING NEW WORKFLOWS
// ============================================================================

/**
 * STEP 1: Define Status Type
 * --------------------------
 * ```typescript
 * export const MY_STATUSES = ['Draft', 'Active', 'Closed'] as const;
 * export type MyStatus = typeof MY_STATUSES[number];
 * ```
 *
 * STEP 2: Define Context Interface
 * --------------------------------
 * ```typescript
 * export interface MyContext extends TransitionContext {
 *   userRole?: 'admin' | 'user';
 *   requiredField?: string;
 * }
 * ```
 *
 * STEP 3: Create Guards
 * ---------------------
 * ```typescript
 * const hasRequiredField = required<MyContext>('requiredField');
 * const isAdmin = when<MyContext>(
 *   ctx => ctx.userRole === 'admin',
 *   'Admin access required'
 * );
 * ```
 *
 * STEP 4: Define Workflow
 * -----------------------
 * ```typescript
 * export const myWorkflow = new Workflow<MyStatus, MyContext>(
 *   { name: 'My Workflow', version: '1.0.0' },
 *   {
 *     'Draft': {
 *       'Active': { guards: [isAdmin] },
 *     },
 *     'Active': {
 *       'Closed': { guards: [hasRequiredField] },
 *     },
 *     'Closed': {},
 *   }
 * );
 * ```
 *
 * STEP 5: Export from index.ts
 * ----------------------------
 * Add exports to lib/workflow/index.ts
 *
 * STEP 6: Create Python Mirror
 * ----------------------------
 * Create equivalent in backend/utils/my_workflow.py
 */

// ============================================================================
// 6. TESTING STRATEGY
// ============================================================================

/**
 * UNIT TESTS FOR WORKFLOW DEFINITIONS:
 *
 * ```typescript
 * describe('RequisitionWorkflow', () => {
 *   it('allows HR to approve from Pending HR Approval', () => {
 *     const result = validateRequisitionTransition(
 *       'Pending HR Approval',
 *       'Approved & Unassigned',
 *       { userRole: 'hr' }
 *     );
 *     expect(result.allowed).toBe(true);
 *   });
 *
 *   it('rejects rejection without reason', () => {
 *     const result = validateRequisitionTransition(
 *       'Pending HR Approval',
 *       'Rejected',
 *       { userRole: 'hr', rejectionReason: '' }
 *     );
 *     expect(result.allowed).toBe(false);
 *     expect(result.error).toContain('10 characters');
 *   });
 *
 *   it('prevents transition from terminal state', () => {
 *     const result = validateRequisitionTransition(
 *       'Rejected',
 *       'Active',
 *       { userRole: 'hr' }
 *     );
 *     expect(result.allowed).toBe(false);
 *   });
 * });
 * ```
 *
 * INTEGRATION TESTS:
 *
 * Test that API endpoints reject same transitions that frontend rejects.
 * This ensures frontend/backend parity.
 */

// ============================================================================
// 7. WHY THIS APPROACH?
// ============================================================================

/**
 * PROBLEMS WITH SCATTERED IF STATEMENTS:
 * --------------------------------------
 * 1. Duplicated logic across components
 * 2. Easy to miss edge cases
 * 3. Hard to audit all rules
 * 4. Inconsistent error messages
 * 5. No single source of truth
 *
 * BENEFITS OF CENTRALIZED WORKFLOW ENGINE:
 * ----------------------------------------
 * 1. SINGLE SOURCE OF TRUTH
 *    All transition rules in one place per domain.
 *    Change once, affect everywhere.
 *
 * 2. DECLARATIVE OVER IMPERATIVE
 *    Rules are data, not scattered code.
 *    Easy to read, audit, and modify.
 *
 * 3. TYPE-SAFE
 *    TypeScript catches invalid status values.
 *    Context types ensure required data is provided.
 *
 * 4. COMPOSABLE GUARDS
 *    Build complex rules from simple parts.
 *    Reuse guards across workflows.
 *
 * 5. TESTABLE
 *    Pure functions, no side effects.
 *    Test rules in isolation.
 *
 * 6. CONSISTENT UX
 *    Same validation messages everywhere.
 *    Predictable behavior for users.
 *
 * 7. SECURE
 *    Backend mirrors frontend rules.
 *    API bypass attempts are blocked.
 *
 * 8. SCALABLE
 *    Add new statuses without touching components.
 *    Add new workflows without duplicating code.
 *
 * TRADEOFFS:
 * ----------
 * - Slightly more upfront setup
 * - Learning curve for state machine pattern
 * - Need to keep frontend/backend in sync
 *
 * These are acceptable costs for a production system where
 * correctness and maintainability are paramount.
 */

export {};
