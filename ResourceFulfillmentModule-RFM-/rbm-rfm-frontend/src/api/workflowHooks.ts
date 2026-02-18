/**
 * ============================================================================
 * WORKFLOW HOOKS - React Hooks for Backend-Driven Workflow
 * ============================================================================
 *
 * These hooks provide a clean React interface for the backend workflow engine.
 * The backend is the SINGLE SOURCE OF TRUTH - these hooks only fetch and
 * execute what the backend permits.
 *
 * Key principles:
 * - Frontend NEVER decides if a transition is allowed
 * - All transitions dynamically rendered from backend response
 * - Optimistic locking via version field
 * - Automatic refresh after transitions
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AllowedTransitionsResponse,
  TransitionInfo,
  WorkflowTransitionResponse,
  WorkflowErrorResponse,
  getRequisitionAllowedTransitions,
  getItemAllowedTransitions,
  submitRequisition,
  approveBudget,
  approveHR,
  rejectRequisition,
  cancelRequisition,
  reopenRequisition,
  assignTA,
  shortlistItem,
  startInterview,
  makeOffer,
  fulfillItem,
  cancelItem,
  getWorkflowErrorMessage,
  isWorkflowError,
  WORKFLOW_ERROR_CODES,
} from "./workflowApi";

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowState {
  /** Current status from backend */
  currentStatus: string;
  /** Whether the entity is in a terminal state */
  isTerminal: boolean;
  /** Allowed transitions from backend */
  allowedTransitions: TransitionInfo[];
  /** Loading state for initial fetch */
  isLoading: boolean;
  /** Loading state for transition execution */
  isTransitioning: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether this is a conflict error (needs refresh) */
  isConflict: boolean;
}

export interface WorkflowActions {
  /** Refresh allowed transitions from backend */
  refresh: () => Promise<void>;
  /** Check if a specific transition is allowed (based on backend response) */
  canTransitionTo: (targetStatus: string) => boolean;
  /** Get transition info for a target status */
  getTransitionInfo: (targetStatus: string) => TransitionInfo | undefined;
  /** Clear any error state */
  clearError: () => void;
}

// ============================================================================
// REQUISITION WORKFLOW HOOK
// ============================================================================

/**
 * Hook for managing requisition workflow state.
 *
 * @param reqId - The requisition ID
 * @param onTransitionComplete - Callback after successful transition
 *
 * @example
 * ```tsx
 * const { state, actions, transitions } = useRequisitionWorkflow(reqId);
 *
 * // Render dynamic buttons
 * {state.allowedTransitions.map(t => (
 *   <button
 *     key={t.target_status}
 *     onClick={() => transitions.execute(t.target_status)}
 *     disabled={state.isTransitioning}
 *   >
 *     {t.target_status}
 *   </button>
 * ))}
 * ```
 */
export function useRequisitionWorkflow(
  reqId: number | null,
  onTransitionComplete?: (response: WorkflowTransitionResponse) => void,
) {
  const [state, setState] = useState<WorkflowState>({
    currentStatus: "",
    isTerminal: false,
    allowedTransitions: [],
    isLoading: true,
    isTransitioning: false,
    error: null,
    isConflict: false,
  });

  // Track current version for optimistic locking
  const versionRef = useRef<number | undefined>(undefined);

  // Fetch allowed transitions
  const refresh = useCallback(async () => {
    if (!reqId) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await getRequisitionAllowedTransitions(reqId);
      setState((prev) => ({
        ...prev,
        currentStatus: response.current_status,
        isTerminal: response.is_terminal,
        allowedTransitions: response.allowed_transitions.filter(
          (t) => !t.is_system_only,
        ),
        isLoading: false,
        error: null,
        isConflict: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: getWorkflowErrorMessage(error),
      }));
    }
  }, [reqId]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Check if transition is allowed
  const canTransitionTo = useCallback(
    (targetStatus: string): boolean => {
      return state.allowedTransitions.some(
        (t) => t.target_status === targetStatus && !t.is_system_only,
      );
    },
    [state.allowedTransitions],
  );

  // Get transition info
  const getTransitionInfo = useCallback(
    (targetStatus: string): TransitionInfo | undefined => {
      return state.allowedTransitions.find(
        (t) => t.target_status === targetStatus,
      );
    },
    [state.allowedTransitions],
  );

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, isConflict: false }));
  }, []);

  // Execute transition helper
  const executeTransition = useCallback(
    async <T extends WorkflowTransitionResponse>(
      transitionFn: () => Promise<T>,
    ): Promise<T | null> => {
      if (!reqId) return null;

      setState((prev) => ({
        ...prev,
        isTransitioning: true,
        error: null,
        isConflict: false,
      }));

      try {
        const response = await transitionFn();
        versionRef.current = undefined; // Reset version after success

        // Refresh to get new allowed transitions
        await refresh();

        // Notify parent
        onTransitionComplete?.(response);

        return response;
      } catch (error) {
        const isConflict = isWorkflowError(
          error,
          WORKFLOW_ERROR_CODES.CONCURRENCY_CONFLICT,
        );
        setState((prev) => ({
          ...prev,
          isTransitioning: false,
          error: getWorkflowErrorMessage(error),
          isConflict,
        }));
        return null;
      }
    },
    [reqId, refresh, onTransitionComplete],
  );

  // Transition functions
  const transitions = {
    submit: useCallback(
      () =>
        executeTransition(() => submitRequisition(reqId!, versionRef.current)),
      [executeTransition, reqId],
    ),

    approveBudget: useCallback(
      () => executeTransition(() => approveBudget(reqId!, versionRef.current)),
      [executeTransition, reqId],
    ),

    approveHR: useCallback(
      () => executeTransition(() => approveHR(reqId!, versionRef.current)),
      [executeTransition, reqId],
    ),

    reject: useCallback(
      (reason: string) =>
        executeTransition(() =>
          rejectRequisition(reqId!, reason, versionRef.current),
        ),
      [executeTransition, reqId],
    ),

    cancel: useCallback(
      (reason: string) =>
        executeTransition(() =>
          cancelRequisition(reqId!, reason, versionRef.current),
        ),
      [executeTransition, reqId],
    ),

    reopen: useCallback(
      () =>
        executeTransition(() => reopenRequisition(reqId!, versionRef.current)),
      [executeTransition, reqId],
    ),
  };

  const actions: WorkflowActions = {
    refresh,
    canTransitionTo,
    getTransitionInfo,
    clearError,
  };

  return { state, actions, transitions };
}

// ============================================================================
// REQUISITION ITEM WORKFLOW HOOK
// ============================================================================

/**
 * Options for useItemWorkflow hook.
 */
export interface ItemWorkflowOptions {
  /** Callback after successful transition */
  onTransitionComplete?: (response: WorkflowTransitionResponse) => void;
  /** Callback to refresh parent requisition after item transition */
  onRefreshParent?: () => Promise<void>;
}

/**
 * Hook for managing requisition item workflow state.
 *
 * @param itemId - The requisition item ID
 * @param options - Hook options including callbacks for transition complete and parent refresh
 *
 * @example
 * ```tsx
 * const { state, actions, transitions } = useItemWorkflow(itemId, {
 *   onTransitionComplete: (response) => console.log('Transitioned to', response.new_status),
 *   onRefreshParent: async () => await refetchRequisition(),
 * });
 * ```
 */
export function useItemWorkflow(
  itemId: number | null,
  options?: ItemWorkflowOptions,
) {
  const { onTransitionComplete, onRefreshParent } = options ?? {};

  const [state, setState] = useState<WorkflowState>({
    currentStatus: "",
    isTerminal: false,
    allowedTransitions: [],
    isLoading: true,
    isTransitioning: false,
    error: null,
    isConflict: false,
  });

  // Fetch allowed transitions
  const refresh = useCallback(async () => {
    if (!itemId) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await getItemAllowedTransitions(itemId);
      setState((prev) => ({
        ...prev,
        currentStatus: response.current_status,
        isTerminal: response.is_terminal,
        allowedTransitions: response.allowed_transitions.filter(
          (t) => !t.is_system_only,
        ),
        isLoading: false,
        error: null,
        isConflict: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: getWorkflowErrorMessage(error),
      }));
    }
  }, [itemId]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Check if transition is allowed
  const canTransitionTo = useCallback(
    (targetStatus: string): boolean => {
      return state.allowedTransitions.some(
        (t) => t.target_status === targetStatus && !t.is_system_only,
      );
    },
    [state.allowedTransitions],
  );

  // Get transition info
  const getTransitionInfo = useCallback(
    (targetStatus: string): TransitionInfo | undefined => {
      return state.allowedTransitions.find(
        (t) => t.target_status === targetStatus,
      );
    },
    [state.allowedTransitions],
  );

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, isConflict: false }));
  }, []);

  // Execute transition helper
  const executeTransition = useCallback(
    async <T extends WorkflowTransitionResponse>(
      transitionFn: () => Promise<T>,
    ): Promise<T | null> => {
      if (!itemId) return null;

      setState((prev) => ({
        ...prev,
        isTransitioning: true,
        error: null,
        isConflict: false,
      }));

      try {
        const response = await transitionFn();

        // Refresh to get new allowed transitions
        await refresh();

        // Refresh parent requisition to sync header state (counters, progress, status)
        if (onRefreshParent) {
          await onRefreshParent();
        }

        // Notify parent
        onTransitionComplete?.(response);

        return response;
      } catch (error) {
        const isConflict = isWorkflowError(
          error,
          WORKFLOW_ERROR_CODES.CONCURRENCY_CONFLICT,
        );
        setState((prev) => ({
          ...prev,
          isTransitioning: false,
          error: getWorkflowErrorMessage(error),
          isConflict,
        }));
        return null;
      }
    },
    [itemId, refresh, onTransitionComplete, onRefreshParent],
  );

  // Transition functions
  const transitions = {
    assignTA: useCallback(
      (taUserId: number) =>
        executeTransition(() => assignTA(itemId!, taUserId)),
      [executeTransition, itemId],
    ),

    shortlist: useCallback(
      (candidateCount?: number) =>
        executeTransition(() => shortlistItem(itemId!, candidateCount)),
      [executeTransition, itemId],
    ),

    startInterview: useCallback(
      () => executeTransition(() => startInterview(itemId!)),
      [executeTransition, itemId],
    ),

    makeOffer: useCallback(
      (candidateId?: string, offerDetails?: Record<string, unknown>) =>
        executeTransition(() => makeOffer(itemId!, candidateId, offerDetails)),
      [executeTransition, itemId],
    ),

    fulfill: useCallback(
      (employeeId: string) =>
        executeTransition(() => fulfillItem(itemId!, employeeId)),
      [executeTransition, itemId],
    ),

    cancel: useCallback(
      (reason: string) => executeTransition(() => cancelItem(itemId!, reason)),
      [executeTransition, itemId],
    ),
  };

  const actions: WorkflowActions = {
    refresh,
    canTransitionTo,
    getTransitionInfo,
    clearError,
  };

  return { state, actions, transitions };
}

// ============================================================================
// WORKFLOW ERROR DISPLAY HOOK
// ============================================================================

/**
 * Hook for managing workflow error display with auto-dismiss.
 */
export function useWorkflowError(autoDismissMs = 5000) {
  const [error, setError] = useState<{
    message: string;
    isConflict: boolean;
  } | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const showError = useCallback(
    (message: string, isConflict = false) => {
      setError({ message, isConflict });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (!isConflict && autoDismissMs > 0) {
        timeoutRef.current = setTimeout(() => {
          setError(null);
        }, autoDismissMs);
      }
    },
    [autoDismissMs],
  );

  const clearError = useCallback(() => {
    setError(null);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { error, showError, clearError };
}
