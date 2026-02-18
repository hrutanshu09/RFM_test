/**
 * ============================================================================
 * WORKFLOW ENGINE - Core State Machine Infrastructure
 * ============================================================================
 *
 * This module provides a generic, reusable workflow engine that enforces
 * state transitions across the application. It is the single source of truth
 * for all status-based business rules.
 *
 * DESIGN PRINCIPLES:
 * 1. Declarative: Define transitions as data, not imperative code
 * 2. Composable: Combine simple guards into complex validation
 * 3. Testable: Pure functions, no side effects
 * 4. Type-safe: Full TypeScript generics support
 * 5. Extensible: Easy to add new workflows or rules
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Result of a transition validation check.
 * Always returns a structured object, never throws.
 */
export interface TransitionResult {
  allowed: boolean;
  error?: string;
  code?: string; // Machine-readable error code for i18n
}

/**
 * Context object passed to guards for conditional validation.
 * Each workflow defines its own context shape.
 */
export type TransitionContext = Record<string, unknown>;

/**
 * A guard function that validates a specific condition.
 * Returns true if the condition is met, or an error message if not.
 */
export type TransitionGuard<TContext extends TransitionContext> = (
  context: TContext,
) => true | string;

/**
 * Configuration for a single transition edge.
 */
export interface TransitionEdge<TContext extends TransitionContext> {
  /** Human-readable description of what this transition does */
  description?: string;
  /** Guards that must all pass for this transition to be allowed */
  guards?: TransitionGuard<TContext>[];
  /** Required fields in context for this transition */
  requiredContext?: (keyof TContext)[];
}

/**
 * A state machine definition mapping each status to its allowed transitions.
 */
export type WorkflowDefinition<
  TStatus extends string,
  TContext extends TransitionContext,
> = {
  [K in TStatus]?: {
    [Target in TStatus]?: TransitionEdge<TContext>;
  };
};

/**
 * Metadata about a workflow for documentation and debugging.
 */
export interface WorkflowMeta {
  name: string;
  version: string;
  description?: string;
}

// ============================================================================
// Workflow Class
// ============================================================================

/**
 * A type-safe workflow engine that enforces state transitions.
 *
 * @example
 * const requisitionWorkflow = new Workflow<RequisitionStatus, ReqContext>({
 *   name: 'Requisition',
 *   version: '1.0.0',
 * }, {
 *   'Pending Budget Approval': {
 *     'Pending HR Approval': { guards: [hasBudget] },
 *     'Rejected': { guards: [hasRejectionReason] },
 *   },
 * });
 *
 * const result = requisitionWorkflow.validate('Pending Budget Approval', 'Rejected', context);
 */
export class Workflow<
  TStatus extends string,
  TContext extends TransitionContext = TransitionContext,
> {
  constructor(
    public readonly meta: WorkflowMeta,
    private readonly definition: WorkflowDefinition<TStatus, TContext>,
  ) {}

  /**
   * Check if a transition is structurally allowed (ignores guards).
   */
  canTransition(current: TStatus, next: TStatus): boolean {
    if (current === next) return false;
    const fromState = this.definition[current];
    if (!fromState) return false;
    return next in fromState;
  }

  /**
   * Get all statuses that can be reached from the current status.
   */
  getAvailableTransitions(current: TStatus): TStatus[] {
    const fromState = this.definition[current];
    if (!fromState) return [];
    return Object.keys(fromState) as TStatus[];
  }

  /**
   * Full validation including guards.
   * This is the primary method components should use.
   */
  validate(
    current: TStatus,
    next: TStatus,
    context: TContext = {} as TContext,
  ): TransitionResult {
    // Same state is a no-op, not an error
    if (current === next) {
      return {
        allowed: false,
        error: "No change in status",
        code: "NO_CHANGE",
      };
    }

    // Check if transition path exists
    const fromState = this.definition[current];
    if (!fromState) {
      return {
        allowed: false,
        error: `No transitions defined from "${current}"`,
        code: "INVALID_SOURCE",
      };
    }

    const edge = fromState[next as TStatus];
    if (!edge) {
      return {
        allowed: false,
        error: `Transition from "${current}" to "${next}" is not allowed`,
        code: "TRANSITION_NOT_ALLOWED",
      };
    }

    // Check required context fields
    if (edge.requiredContext) {
      for (const field of edge.requiredContext) {
        if (context[field] === undefined || context[field] === null) {
          return {
            allowed: false,
            error: `Missing required field: ${String(field)}`,
            code: "MISSING_CONTEXT",
          };
        }
      }
    }

    // Run all guards
    if (edge.guards) {
      for (const guard of edge.guards) {
        const result = guard(context);
        if (result !== true) {
          return {
            allowed: false,
            error: result,
            code: "GUARD_FAILED",
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Validate and throw if not allowed (for imperative code paths).
   */
  assertTransition(
    current: TStatus,
    next: TStatus,
    context: TContext = {} as TContext,
  ): void {
    const result = this.validate(current, next, context);
    if (!result.allowed) {
      throw new WorkflowError(
        result.error ?? "Transition not allowed",
        result.code,
      );
    }
  }

  /**
   * Get the edge configuration for a specific transition.
   */
  getEdge(
    current: TStatus,
    next: TStatus,
  ): TransitionEdge<TContext> | undefined {
    return this.definition[current]?.[next as TStatus];
  }
}

// ============================================================================
// Error Class
// ============================================================================

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

// ============================================================================
// Guard Factory Functions
// ============================================================================

/**
 * Creates a guard that checks if a string field has minimum length.
 */
export function minLength<TContext extends TransitionContext>(
  field: keyof TContext,
  min: number,
  message?: string,
): TransitionGuard<TContext> {
  return (ctx) => {
    const value = ctx[field];
    if (typeof value !== "string" || value.trim().length < min) {
      return message ?? `${String(field)} must be at least ${min} characters`;
    }
    return true;
  };
}

/**
 * Creates a guard that checks if a field is truthy.
 */
export function required<TContext extends TransitionContext>(
  field: keyof TContext,
  message?: string,
): TransitionGuard<TContext> {
  return (ctx) => {
    const value = ctx[field];
    if (value === undefined || value === null || value === "") {
      return message ?? `${String(field)} is required`;
    }
    return true;
  };
}

/**
 * Creates a guard that checks if a date field is set.
 */
export function hasDate<TContext extends TransitionContext>(
  field: keyof TContext,
  message?: string,
): TransitionGuard<TContext> {
  return (ctx) => {
    const value = ctx[field];
    if (!value) {
      return message ?? `${String(field)} date is required`;
    }
    return true;
  };
}

/**
 * Creates a guard that checks a boolean condition.
 */
export function when<TContext extends TransitionContext>(
  predicate: (ctx: TContext) => boolean,
  errorMessage: string,
): TransitionGuard<TContext> {
  return (ctx) => (predicate(ctx) ? true : errorMessage);
}

/**
 * Creates a guard that checks if a numeric field meets a minimum.
 */
export function minValue<TContext extends TransitionContext>(
  field: keyof TContext,
  min: number,
  message?: string,
): TransitionGuard<TContext> {
  return (ctx) => {
    const value = ctx[field];
    if (typeof value !== "number" || value < min) {
      return message ?? `${String(field)} must be at least ${min}`;
    }
    return true;
  };
}

/**
 * Combines multiple guards with AND logic.
 */
export function allOf<TContext extends TransitionContext>(
  ...guards: TransitionGuard<TContext>[]
): TransitionGuard<TContext> {
  return (ctx) => {
    for (const guard of guards) {
      const result = guard(ctx);
      if (result !== true) return result;
    }
    return true;
  };
}

/**
 * Combines multiple guards with OR logic.
 */
export function anyOf<TContext extends TransitionContext>(
  ...guards: TransitionGuard<TContext>[]
): TransitionGuard<TContext> {
  return (ctx) => {
    const errors: string[] = [];
    for (const guard of guards) {
      const result = guard(ctx);
      if (result === true) return true;
      errors.push(result);
    }
    return errors.join(" OR ");
  };
}
