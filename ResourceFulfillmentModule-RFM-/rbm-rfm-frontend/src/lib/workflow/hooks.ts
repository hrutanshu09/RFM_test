/**
 * ============================================================================
 * WORKFLOW HOOKS - React Integration
 * ============================================================================
 *
 * Custom React hooks for integrating workflow validation into components.
 * Provides reactive state management for workflow transitions.
 */

import { useState, useCallback, useMemo } from "react";
import { Workflow, TransitionContext, TransitionResult } from "./engine";

// ============================================================================
// useWorkflowTransition Hook
// ============================================================================

export interface WorkflowTransitionState<TStatus extends string> {
  /** Current status of the entity */
  currentStatus: TStatus;
  /** Pending target status (during transition flow) */
  pendingStatus: TStatus | null;
  /** Validation result for pending transition */
  validationResult: TransitionResult | null;
  /** Whether a transition is in progress (API call) */
  isTransitioning: boolean;
  /** Error from API call (separate from validation) */
  apiError: string | null;
}

export interface WorkflowTransitionActions<
  TStatus extends string,
  TContext extends TransitionContext,
> {
  /** Check if transition to target status is allowed */
  canTransitionTo: (target: TStatus) => boolean;
  /** Validate transition with context */
  validateTransition: (target: TStatus, context?: TContext) => TransitionResult;
  /** Set pending transition (for multi-step flows like modals) */
  setPendingTransition: (target: TStatus | null) => void;
  /** Execute transition (calls API, updates state) */
  executeTransition: (
    target: TStatus,
    context: TContext,
    apiCall: () => Promise<void>,
  ) => Promise<boolean>;
  /** Get all available target statuses */
  getAvailableTransitions: () => TStatus[];
  /** Clear error state */
  clearError: () => void;
  /** Reset to initial state */
  reset: (newStatus: TStatus) => void;
}

/**
 * Hook for managing workflow transitions in React components.
 *
 * @example
 * const { canTransitionTo, executeTransition, validationResult } = useWorkflowTransition(
 *   requisitionWorkflow,
 *   requisition.status as RequisitionStatus
 * );
 *
 * // Check if approve button should be enabled
 * const canApprove = canTransitionTo('Approved & Unassigned');
 *
 * // Execute transition with API call
 * await executeTransition('Approved & Unassigned', { userRole: 'hr' }, async () => {
 *   await apiClient.put(`/requisitions/${id}/approve`);
 * });
 */
export function useWorkflowTransition<
  TStatus extends string,
  TContext extends TransitionContext,
>(
  workflow: Workflow<TStatus, TContext>,
  initialStatus: TStatus,
): WorkflowTransitionState<TStatus> &
  WorkflowTransitionActions<TStatus, TContext> {
  const [currentStatus, setCurrentStatus] = useState<TStatus>(initialStatus);
  const [pendingStatus, setPendingStatus] = useState<TStatus | null>(null);
  const [validationResult, setValidationResult] =
    useState<TransitionResult | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const canTransitionTo = useCallback(
    (target: TStatus): boolean => {
      return workflow.canTransition(currentStatus, target);
    },
    [workflow, currentStatus],
  );

  const validateTransition = useCallback(
    (target: TStatus, context: TContext = {} as TContext): TransitionResult => {
      const result = workflow.validate(currentStatus, target, context);
      setValidationResult(result);
      return result;
    },
    [workflow, currentStatus],
  );

  const setPendingTransition = useCallback((target: TStatus | null) => {
    setPendingStatus(target);
    setValidationResult(null);
    setApiError(null);
  }, []);

  const executeTransition = useCallback(
    async (
      target: TStatus,
      context: TContext,
      apiCall: () => Promise<void>,
    ): Promise<boolean> => {
      // Validate first
      const result = workflow.validate(currentStatus, target, context);
      setValidationResult(result);

      if (!result.allowed) {
        return false;
      }

      // Execute API call
      setIsTransitioning(true);
      setApiError(null);

      try {
        await apiCall();
        setCurrentStatus(target);
        setPendingStatus(null);
        setValidationResult(null);
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Transition failed";
        setApiError(message);
        return false;
      } finally {
        setIsTransitioning(false);
      }
    },
    [workflow, currentStatus],
  );

  const getAvailableTransitions = useCallback((): TStatus[] => {
    return workflow.getAvailableTransitions(currentStatus);
  }, [workflow, currentStatus]);

  const clearError = useCallback(() => {
    setApiError(null);
    setValidationResult(null);
  }, []);

  const reset = useCallback((newStatus: TStatus) => {
    setCurrentStatus(newStatus);
    setPendingStatus(null);
    setValidationResult(null);
    setIsTransitioning(false);
    setApiError(null);
  }, []);

  return {
    // State
    currentStatus,
    pendingStatus,
    validationResult,
    isTransitioning,
    apiError,
    // Actions
    canTransitionTo,
    validateTransition,
    setPendingTransition,
    executeTransition,
    getAvailableTransitions,
    clearError,
    reset,
  };
}

// ============================================================================
// useWorkflowActions Hook
// ============================================================================

export interface WorkflowAction<TStatus extends string> {
  id: string;
  label: string;
  targetStatus: TStatus;
  variant: "primary" | "secondary" | "danger" | "warning";
  icon?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

export interface WorkflowActionConfig<TStatus extends string> {
  [key: string]: WorkflowAction<TStatus>;
}

/**
 * Hook for generating action buttons based on current workflow state.
 *
 * @example
 * const actions = useWorkflowActions(
 *   requisitionWorkflow,
 *   currentStatus,
 *   REQUISITION_ACTIONS,
 *   { userRole: 'hr' }
 * );
 *
 * // Render only enabled actions
 * actions.map(action => (
 *   <button disabled={!action.enabled}>{action.label}</button>
 * ))
 */
export function useWorkflowActions<
  TStatus extends string,
  TContext extends TransitionContext,
>(
  workflow: Workflow<TStatus, TContext>,
  currentStatus: TStatus,
  actionConfig: WorkflowActionConfig<TStatus>,
  context: TContext = {} as TContext,
) {
  return useMemo(() => {
    return Object.values(actionConfig).map((action) => {
      const validationResult = workflow.validate(
        currentStatus,
        action.targetStatus,
        context,
      );

      return {
        ...action,
        enabled: validationResult.allowed,
        error: validationResult.error,
      };
    });
  }, [workflow, currentStatus, actionConfig, context]);
}

// ============================================================================
// useWorkflowValidation Hook (Lightweight)
// ============================================================================

/**
 * Lightweight hook for just checking if transitions are valid.
 * Use when you don't need full transition execution capabilities.
 *
 * @example
 * const { canApprove, canReject } = useWorkflowValidation(
 *   requisitionWorkflow,
 *   currentStatus,
 *   ['Approved & Unassigned', 'Rejected'],
 *   { userRole: 'hr' }
 * );
 */
export function useWorkflowValidation<
  TStatus extends string,
  TContext extends TransitionContext,
>(
  workflow: Workflow<TStatus, TContext>,
  currentStatus: TStatus,
  targetStatuses: TStatus[],
  context: TContext = {} as TContext,
): Record<string, TransitionResult> {
  return useMemo(() => {
    const results: Record<string, TransitionResult> = {};

    for (const target of targetStatuses) {
      const key = `can${target.replace(/[^a-zA-Z0-9]/g, "")}`;
      results[key] = workflow.validate(currentStatus, target, context);
    }

    return results;
  }, [workflow, currentStatus, targetStatuses, context]);
}
