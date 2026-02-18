/**
 * ============================================================================
 * WORKFLOW MODULE - Public Exports
 * ============================================================================
 *
 * @deprecated This module contains frontend-side workflow logic which is now
 * superseded by the backend-driven Workflow Engine V2.
 *
 * For new code, use the backend-driven workflow API:
 * - Import from 'api/workflowApi' for API functions and types
 * - Import from 'api/workflowHooks' for React hooks
 * - Import from 'components/workflow' for UI components
 *
 * The backend is the SINGLE SOURCE OF TRUTH for workflow state and transitions.
 * Frontend must NEVER decide if a transition is allowed.
 *
 * See: docs/WORKFLOW_SPECIFICATION.md
 * ============================================================================
 */

// Core engine
export {
  Workflow,
  WorkflowError,
  // Guard factories
  minLength,
  required,
  hasDate,
  when,
  minValue,
  allOf,
  anyOf,
  // Types
  type TransitionResult,
  type TransitionContext,
  type TransitionGuard,
  type TransitionEdge,
  type WorkflowDefinition,
  type WorkflowMeta,
} from "./engine";

// Requisition workflow
export {
  requisitionWorkflow,
  canTransitionRequisition,
  validateRequisitionTransition,
  getRequisitionNextStatuses,
  isTerminalRequisitionStatus,
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  REQUISITION_STATUS_CLASSES,
  type RequisitionStatus,
  type RequisitionContext,
} from "./requisition.workflow";

// Employee lifecycle workflow
export {
  employeeLifecycleWorkflow,
  canTransitionEmployee,
  validateEmployeeTransition,
  getEmployeeNextStatuses,
  isTerminalEmployeeStatus,
  EMPLOYEE_LIFECYCLE_STATUSES,
  ONBOARDING_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_CLASSES,
  type EmployeeLifecycleStatus,
  type OnboardingStatus,
  type EmployeeLifecycleContext,
} from "./employee.workflow";

// TA Ticket workflow
export {
  taTicketWorkflow,
  canTransitionTATicket,
  validateTATicketTransition,
  getTATicketNextStatuses,
  isTerminalTAStatus,
  TA_TICKET_STATUSES,
  TA_TICKET_STATUS_LABELS,
  TA_TICKET_STATUS_CLASSES,
  type TATicketStatus,
  type TATicketContext,
} from "./ta-ticket.workflow";

// Budget workflow
export {
  budgetWorkflow,
  canTransitionBudget,
  validateBudgetTransition,
  getBudgetNextStatuses,
  isTerminalBudgetStatus,
  canEditBudget,
  isBudgetLocked,
  BUDGET_STATUSES,
  BUDGET_STATUS_LABELS,
  BUDGET_STATUS_CLASSES,
  type BudgetStatus,
  type BudgetContext,
} from "./budget.workflow";

// React hooks
export {
  useWorkflowTransition,
  useWorkflowActions,
  useWorkflowValidation,
  type WorkflowTransitionState,
  type WorkflowTransitionActions,
  type WorkflowAction,
  type WorkflowActionConfig,
} from "./hooks";
