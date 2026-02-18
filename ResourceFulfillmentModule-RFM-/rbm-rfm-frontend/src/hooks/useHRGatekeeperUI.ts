/**
 * ============================================================================
 * useHRGatekeeperUI - State Management for Gatekeeper Phase 2
 * ============================================================================
 *
 * Hook for managing HR Gatekeeper workflow state when requisition is in
 * PENDING_BUDGET status.
 *
 * Responsibilities:
 * - Track edited item budgets
 * - Track dirty state (unsaved changes)
 * - Validate all fields
 * - Compute disableApprove flag
 * - Reset state on success
 */

import { useState, useCallback, useMemo } from "react";
import type { RequisitionItem, Requisition } from "../types/workflow";

// ============================================================================
// TYPES
// ============================================================================

export interface ItemBudgetEdit {
  item_id: number;
  estimated_budget: string;
  currency: string;
  isDirty: boolean;
  isValid: boolean;
  error: string | null;
}

export interface GatekeeperValidation {
  budgetApprovedBy: string;
  budgetApprovedByError: string | null;
  approvedBy: string;
  approvedByError: string | null;
}

export interface GatekeeperState {
  itemEdits: Record<number, ItemBudgetEdit>;
  validation: GatekeeperValidation;
  isSubmitting: boolean;
  globalError: string | null;
  globalMessage: string | null;
}

export interface GatekeeperActions {
  setItemBudget: (itemId: number, budget: string) => void;
  setItemCurrency: (itemId: number, currency: string) => void;
  setBudgetApprovedBy: (value: string) => void;
  setApprovedBy: (value: string) => void;
  validateItem: (itemId: number) => boolean;
  validateAll: () => boolean;
  resetItemEdit: (itemId: number) => void;
  resetAllEdits: () => void;
  setSubmitting: (value: boolean) => void;
  setGlobalError: (error: string | null) => void;
  setGlobalMessage: (message: string | null) => void;
  initializeFromRequisition: (requisition: Requisition) => void;
}

export interface GatekeeperComputed {
  hasUnsavedChanges: boolean;
  hasInvalidBudgets: boolean;
  canApprove: boolean;
  dirtyItemIds: number[];
  invalidItemIds: number[];
  totalEstimatedBudget: number;
  totalApprovedBudget: number;
  allItemsApproved: boolean;
  pendingItemsCount: number;
}

export interface UseHRGatekeeperUIReturn {
  state: GatekeeperState;
  actions: GatekeeperActions;
  computed: GatekeeperComputed;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "SGD"] as const;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateBudget(value: string): {
  isValid: boolean;
  error: string | null;
} {
  if (!value || value.trim() === "") {
    return { isValid: false, error: "Budget is required" };
  }

  const numValue = parseFloat(value.replace(/,/g, ""));
  if (isNaN(numValue)) {
    return { isValid: false, error: "Must be a valid number" };
  }

  if (numValue <= 0) {
    return { isValid: false, error: "Budget must be greater than 0" };
  }

  return { isValid: true, error: null };
}

function validateRequired(value: string, fieldName: string): string | null {
  if (!value || value.trim() === "") {
    return `${fieldName} is required`;
  }
  return null;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useHRGatekeeperUI(
  requisition: Requisition | null,
  userRole: string,
): UseHRGatekeeperUIReturn {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const [itemEdits, setItemEdits] = useState<Record<number, ItemBudgetEdit>>(
    {},
  );
  const [validation, setValidation] = useState<GatekeeperValidation>({
    budgetApprovedBy: "",
    budgetApprovedByError: null,
    approvedBy: "",
    approvedByError: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // CONTEXT CHECKS
  // ---------------------------------------------------------------------------

  const isPendingBudget = requisition?.overall_status === "Pending_Budget";
  const isHRRole =
    userRole.toLowerCase() === "hr" || userRole.toLowerCase() === "admin";

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------

  const initializeFromRequisition = useCallback((req: Requisition) => {
    const edits: Record<number, ItemBudgetEdit> = {};

    req.items.forEach((item) => {
      const budgetStr =
        (item.approved_budget ?? item.estimated_budget)?.toString() || "";
      const validation = validateBudget(budgetStr);

      edits[item.item_id] = {
        item_id: item.item_id,
        estimated_budget: budgetStr,
        currency: item.currency || "INR",
        isDirty: false,
        isValid: validation.isValid,
        error: validation.error,
      };
    });

    setItemEdits(edits);

    // Reset validation fields
    setValidation({
      budgetApprovedBy: "",
      budgetApprovedByError: null,
      approvedBy: "",
      approvedByError: null,
    });

    setGlobalError(null);
    setGlobalMessage(null);
  }, []);

  const setItemBudget = useCallback(
    (itemId: number, budget: string) => {
      setItemEdits((prev) => {
        const currentEdit = prev[itemId];
        if (!currentEdit) return prev;

        const originalItem = requisition?.items.find(
          (i) => i.item_id === itemId,
        );
        const originalBudget =
          (
            originalItem?.approved_budget ?? originalItem?.estimated_budget
          )?.toString() || "";
        const validation = validateBudget(budget);

        return {
          ...prev,
          [itemId]: {
            ...currentEdit,
            estimated_budget: budget,
            isDirty: budget !== originalBudget,
            isValid: validation.isValid,
            error: validation.error,
          },
        };
      });
    },
    [requisition],
  );

  const setItemCurrency = useCallback(
    (itemId: number, currency: string) => {
      setItemEdits((prev) => {
        const currentEdit = prev[itemId];
        if (!currentEdit) return prev;

        const originalItem = requisition?.items.find(
          (i) => i.item_id === itemId,
        );
        const originalCurrency = originalItem?.currency || "INR";

        return {
          ...prev,
          [itemId]: {
            ...currentEdit,
            currency,
            isDirty: currentEdit.isDirty || currency !== originalCurrency,
          },
        };
      });
    },
    [requisition],
  );

  const setBudgetApprovedBy = useCallback((value: string) => {
    const error = validateRequired(value, "Budget approver");
    setValidation((prev) => ({
      ...prev,
      budgetApprovedBy: value,
      budgetApprovedByError: error,
    }));
  }, []);

  const setApprovedBy = useCallback((value: string) => {
    const error = validateRequired(value, "HR approver");
    setValidation((prev) => ({
      ...prev,
      approvedBy: value,
      approvedByError: error,
    }));
  }, []);

  const validateItem = useCallback((itemId: number): boolean => {
    let isValid = false;

    setItemEdits((prev) => {
      const edit = prev[itemId];
      if (!edit) {
        isValid = false;
        return prev;
      }

      const validation = validateBudget(edit.estimated_budget);
      isValid = validation.isValid;

      return {
        ...prev,
        [itemId]: {
          ...edit,
          isValid: validation.isValid,
          error: validation.error,
        },
      };
    });

    return isValid;
  }, []);

  const validateAll = useCallback((): boolean => {
    let allValid = true;

    // Validate all items
    const updatedEdits = { ...itemEdits };
    Object.keys(updatedEdits).forEach((key) => {
      const itemId = parseInt(key, 10);
      const edit = updatedEdits[itemId];
      const validation = validateBudget(edit.estimated_budget);

      updatedEdits[itemId] = {
        ...edit,
        isValid: validation.isValid,
        error: validation.error,
      };

      if (!validation.isValid) {
        allValid = false;
      }
    });
    setItemEdits(updatedEdits);

    // Validate approver fields
    const budgetApproverError = validateRequired(
      validation.budgetApprovedBy,
      "Budget approver",
    );
    const hrApproverError = validateRequired(
      validation.approvedBy,
      "HR approver",
    );

    setValidation((prev) => ({
      ...prev,
      budgetApprovedByError: budgetApproverError,
      approvedByError: hrApproverError,
    }));

    if (budgetApproverError || hrApproverError) {
      allValid = false;
    }

    return allValid;
  }, [itemEdits, validation]);

  const resetItemEdit = useCallback(
    (itemId: number) => {
      const originalItem = requisition?.items.find((i) => i.item_id === itemId);
      if (!originalItem) return;

      const budgetStr =
        (
          originalItem.approved_budget ?? originalItem.estimated_budget
        )?.toString() || "";
      const validationResult = validateBudget(budgetStr);

      setItemEdits((prev) => ({
        ...prev,
        [itemId]: {
          item_id: itemId,
          estimated_budget: budgetStr,
          currency: originalItem.currency || "INR",
          isDirty: false,
          isValid: validationResult.isValid,
          error: validationResult.error,
        },
      }));
    },
    [requisition],
  );

  const resetAllEdits = useCallback(() => {
    if (requisition) {
      initializeFromRequisition(requisition);
    }
  }, [requisition, initializeFromRequisition]);

  // ---------------------------------------------------------------------------
  // COMPUTED VALUES
  // ---------------------------------------------------------------------------

  const computed = useMemo((): GatekeeperComputed => {
    const editValues = Object.values(itemEdits);

    const dirtyItemIds = editValues
      .filter((e) => e.isDirty)
      .map((e) => e.item_id);

    const invalidItemIds = editValues
      .filter((e) => !e.isValid)
      .map((e) => e.item_id);

    const hasUnsavedChanges = dirtyItemIds.length > 0;
    const hasInvalidBudgets = invalidItemIds.length > 0;

    // Estimated budget should remain immutable (manager-provided baseline)
    const totalEstimatedBudget =
      requisition?.items.reduce(
        (sum, item) => sum + (item.estimated_budget || 0),
        0,
      ) || 0;

    // Get approved budget from original requisition
    const totalApprovedBudget = requisition?.total_approved_budget || 0;

    // Check if all items have approved budgets (from original data)
    const allItemsApproved =
      requisition?.items.every(
        (item) => item.approved_budget !== null && item.approved_budget > 0,
      ) ?? false;

    const pendingItemsCount =
      requisition?.items.filter(
        (item) => item.approved_budget === null || item.approved_budget <= 0,
      ).length ?? 0;

    // Can approve only if:
    // - Status is PENDING_BUDGET
    // - User is HR
    // - No unsaved changes
    // - No invalid budgets
    // - Both approver fields filled
    // - All items have valid estimated_budget > 0
    const budgetApproverValid = validation.budgetApprovedBy.trim() !== "";
    const hrApproverValid = validation.approvedBy.trim() !== "";

    const canApprove =
      isPendingBudget &&
      isHRRole &&
      !hasUnsavedChanges &&
      !hasInvalidBudgets &&
      budgetApproverValid &&
      hrApproverValid &&
      !isSubmitting;

    return {
      hasUnsavedChanges,
      hasInvalidBudgets,
      canApprove,
      dirtyItemIds,
      invalidItemIds,
      totalEstimatedBudget,
      totalApprovedBudget,
      allItemsApproved,
      pendingItemsCount,
    };
  }, [
    itemEdits,
    requisition,
    validation,
    isPendingBudget,
    isHRRole,
    isSubmitting,
  ]);

  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------

  return {
    state: {
      itemEdits,
      validation,
      isSubmitting,
      globalError,
      globalMessage,
    },
    actions: {
      setItemBudget,
      setItemCurrency,
      setBudgetApprovedBy,
      setApprovedBy,
      validateItem,
      validateAll,
      resetItemEdit,
      resetAllEdits,
      setSubmitting: setIsSubmitting,
      setGlobalError,
      setGlobalMessage,
      initializeFromRequisition,
    },
    computed,
  };
}

export default useHRGatekeeperUI;
