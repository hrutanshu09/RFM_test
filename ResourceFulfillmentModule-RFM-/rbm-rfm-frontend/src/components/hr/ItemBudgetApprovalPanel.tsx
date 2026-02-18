/**
 * ============================================================================
 * Item Budget Approval Panel - HR Per-Item Budget Controls
 * ============================================================================
 *
 * Displays requisitions in PENDING_BUDGET status with per-item budget controls.
 * HR can edit, approve, or reject each item's budget individually.
 *
 * WORKFLOW COMPLIANCE:
 * - No header-level budget approvals
 * - Each item must be approved individually
 * - Header auto-transitions to PENDING_HR when all items are approved
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { apiClient } from "../../api/client";
import {
  approveItemBudget,
  rejectItemBudget,
  getWorkflowErrorMessage,
} from "../../api/workflowApi";
import type {
  RequisitionItem,
  Requisition,
  ItemBudgetResponse,
} from "../../types/workflow";
import { useAuth } from "../../contexts/useAuth";

// ============================================================================
// TYPES
// ============================================================================

interface BudgetApprovalRequisition {
  req_id: number;
  project_name: string | null;
  client_name: string | null;
  overall_status: string;
  raised_by_name: string | null;
  created_at: string | null;
  items: RequisitionItem[];
  // Computed totals
  total_estimated_budget: number | null;
  total_approved_budget: number | null;
  budget_approval_status: string | null;
}

interface ItemActionState {
  editing: boolean;
  approving: boolean;
  rejecting: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CURRENCIES = [
  { code: "INR", label: "INR", symbol: "₹" },
  { code: "USD", label: "USD", symbol: "$" },
  { code: "EUR", label: "EUR", symbol: "€" },
  { code: "GBP", label: "GBP", symbol: "£" },
  { code: "AUD", label: "AUD", symbol: "A$" },
  { code: "SGD", label: "SGD", symbol: "S$" },
] as const;

const getCurrencySymbol = (code: string): string => {
  return CURRENCIES.find((c) => c.code === code)?.symbol || "₹";
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ItemBudgetApprovalPanel: React.FC = () => {
  const { user } = useAuth();

  // Data state
  const [requisitions, setRequisitions] = useState<BudgetApprovalRequisition[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // UI state
  const [expandedReqs, setExpandedReqs] = useState<Set<number>>(new Set());
  const [actionStates, setActionStates] = useState<
    Record<number, ItemActionState>
  >({});

  // Edit modal state
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item: RequisitionItem | null;
  }>({ open: false, item: null });
  const [editBudget, setEditBudget] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Approver identity (required before approving/saving approved amount)
  const [budgetApprovedBy, setBudgetApprovedBy] = useState("");

  // Approve modal state (approved amount can differ from estimated)
  const [approveModal, setApproveModal] = useState<{
    open: boolean;
    item: RequisitionItem | null;
  }>({ open: false, item: null });
  const [approveAmount, setApproveAmount] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSubmitting, setApproveSubmitting] = useState(false);

  // Reject modal state
  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    item: RequisitionItem | null;
  }>({ open: false, item: null });
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Access control
  const hasAccess = useMemo(() => {
    const roles = (user?.roles || []).map((role) => role.toLowerCase());
    return roles.includes("hr") || roles.includes("admin");
  }, [user?.roles]);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const loadPendingBudgetRequisitions = useCallback(async () => {
    if (!hasAccess) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch requisitions with PENDING_BUDGET status
      const response = await apiClient.get<BudgetApprovalRequisition[]>(
        "/requisitions/",
        { params: { status: "Pending_Budget" } },
      );
      setRequisitions(response.data);

      // Auto-expand all requisitions
      setExpandedReqs(new Set(response.data.map((r) => r.req_id)));
    } catch (err) {
      setError(getWorkflowErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [hasAccess]);

  useEffect(() => {
    loadPendingBudgetRequisitions();
  }, [loadPendingBudgetRequisitions]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const toggleRequisition = (reqId: number) => {
    setExpandedReqs((prev) => {
      const next = new Set(prev);
      if (next.has(reqId)) {
        next.delete(reqId);
      } else {
        next.add(reqId);
      }
      return next;
    });
  };

  const setItemActionState = (
    itemId: number,
    state: Partial<ItemActionState>,
  ) => {
    const defaultState: ItemActionState = {
      editing: false,
      approving: false,
      rejecting: false,
    };
    setActionStates((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? defaultState), ...state },
    }));
  };

  // ---------- Edit Budget ----------

  const openEditModal = (item: RequisitionItem) => {
    setEditModal({ open: true, item });
    setEditBudget(
      (item.approved_budget ?? item.estimated_budget)?.toString() || "",
    );
    setEditError(null);
  };

  const closeEditModal = () => {
    setEditModal({ open: false, item: null });
    setEditBudget("");
    setEditError(null);
  };

  const handleEditSubmit = async () => {
    if (!editModal.item) return;

    if (!budgetApprovedBy.trim()) {
      setEditError("Please enter Budget Approved By before saving.");
      return;
    }

    const budgetValue = parseFloat(editBudget.replace(/,/g, ""));
    if (isNaN(budgetValue) || budgetValue <= 0) {
      setEditError("Budget must be a positive number.");
      return;
    }

    setEditSubmitting(true);
    setEditError(null);

    try {
      const response: ItemBudgetResponse = await approveItemBudget(
        editModal.item.item_id,
        { approved_budget: budgetValue },
      );

      if (response.success) {
        setMessage(
          `Approved budget saved for item #${editModal.item.item_id} (by ${budgetApprovedBy.trim()})`,
        );
        closeEditModal();
        loadPendingBudgetRequisitions(); // Refresh data
      }
    } catch (err) {
      setEditError(getWorkflowErrorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  };

  // ---------- Approve Budget ----------

  const openApproveModal = (item: RequisitionItem) => {
    if ((item.estimated_budget || 0) <= 0) {
      setError("Cannot approve item with zero or negative budget.");
      return;
    }
    setApproveModal({ open: true, item });
    setApproveAmount(String(item.estimated_budget ?? ""));
    setApproveError(null);
  };

  const closeApproveModal = () => {
    setApproveModal({ open: false, item: null });
    setApproveAmount("");
    setApproveError(null);
  };

  const handleApproveSubmit = async () => {
    if (!approveModal.item) return;

    if (!budgetApprovedBy.trim()) {
      setApproveError("Please enter Budget Approved By before approving.");
      return;
    }

    const value = parseFloat(approveAmount.replace(/,/g, ""));
    if (Number.isNaN(value) || value <= 0) {
      setApproveError("Approved amount must be a number greater than 0.");
      return;
    }

    setApproveSubmitting(true);
    setApproveError(null);

    try {
      const response: ItemBudgetResponse = await approveItemBudget(
        approveModal.item.item_id,
        { approved_budget: value },
      );

      if (response.success) {
        setMessage(
          `Budget approved for item #${approveModal.item.item_id} (by ${budgetApprovedBy.trim()})`,
        );
        closeApproveModal();
        loadPendingBudgetRequisitions();
      }
    } catch (err) {
      setApproveError(getWorkflowErrorMessage(err));
    } finally {
      setApproveSubmitting(false);
    }
  };

  // ---------- Reject Budget ----------

  const openRejectModal = (item: RequisitionItem) => {
    setRejectModal({ open: true, item });
    setRejectReason("");
    setRejectError(null);
  };

  const closeRejectModal = () => {
    setRejectModal({ open: false, item: null });
    setRejectReason("");
    setRejectError(null);
  };

  const handleRejectSubmit = async () => {
    if (!rejectModal.item) return;

    if (rejectReason.trim().length < 10) {
      setRejectError("Reason must be at least 10 characters.");
      return;
    }

    setItemActionState(rejectModal.item.item_id, { rejecting: true });

    try {
      const response: ItemBudgetResponse = await rejectItemBudget(
        rejectModal.item.item_id,
        { reason: rejectReason.trim() },
      );

      if (response.success) {
        setMessage(`Budget rejected for item #${rejectModal.item.item_id}`);
        closeRejectModal();
        loadPendingBudgetRequisitions(); // Refresh data
      }
    } catch (err) {
      setRejectError(getWorkflowErrorMessage(err));
    } finally {
      if (rejectModal.item) {
        setItemActionState(rejectModal.item.item_id, { rejecting: false });
      }
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const getBudgetStatusBadge = (item: RequisitionItem) => {
    if (
      item.approved_budget !== null &&
      item.approved_budget !== undefined &&
      item.approved_budget > 0
    ) {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
          Approved
        </span>
      );
    }
    if ((item.estimated_budget || 0) <= 0) {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
          No Budget
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">
        Pending
      </span>
    );
  };

  const renderItemRow = (item: RequisitionItem) => {
    const actionState = actionStates[item.item_id] || {
      editing: false,
      approving: false,
      rejecting: false,
    };
    const isApproved =
      item.approved_budget !== null &&
      item.approved_budget !== undefined &&
      item.approved_budget > 0;
    const canApprove = !isApproved && (item.estimated_budget || 0) > 0;
    const currSymbol = getCurrencySymbol(item.currency);

    return (
      <tr key={item.item_id} className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <span className="font-mono text-xs text-slate-500">
            #{item.item_id}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-slate-800">{item.role_position}</div>
          {item.skill_level && (
            <div className="text-xs text-slate-500">{item.skill_level}</div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <span className="font-medium">
            {currSymbol}
            {(item.estimated_budget || 0).toLocaleString()}
          </span>
          <span className="text-xs text-slate-500 ml-1">{item.currency}</span>
        </td>
        <td className="px-4 py-3 text-right">
          {isApproved ? (
            <span className="font-medium text-green-700">
              {currSymbol}
              {(item.approved_budget || 0).toLocaleString()}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">{getBudgetStatusBadge(item)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {!isApproved && (
              <>
                <button
                  onClick={() => openEditModal(item)}
                  disabled={actionState.approving || actionState.rejecting}
                  className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                  title="Set Approved Budget"
                >
                  <DollarSign size={14} />
                </button>

                <button
                  onClick={() => openApproveModal(item)}
                  disabled={
                    !canApprove ||
                    actionState.approving ||
                    actionState.rejecting
                  }
                  className={`p-1.5 rounded transition-colors ${
                    canApprove
                      ? "text-green-600 hover:bg-green-50"
                      : "text-slate-300 cursor-not-allowed"
                  }`}
                  title={
                    canApprove ? "Approve Budget" : "Cannot approve (no budget)"
                  }
                >
                  {actionState.approving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle size={14} />
                  )}
                </button>

                <button
                  onClick={() => openRejectModal(item)}
                  disabled={actionState.approving || actionState.rejecting}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                  title="Reject Budget"
                >
                  {actionState.rejecting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <XCircle size={14} />
                  )}
                </button>
              </>
            )}
            {isApproved && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle size={12} /> Approved
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const renderRequisitionCard = (req: BudgetApprovalRequisition) => {
    const isExpanded = expandedReqs.has(req.req_id);
    const totalEstimated = req.total_estimated_budget || 0;
    const totalApproved = req.total_approved_budget || 0;
    const approvedCount = req.items.filter(
      (i) => i.approved_budget !== null && i.approved_budget > 0,
    ).length;
    const totalCount = req.items.length;

    return (
      <div
        key={req.req_id}
        className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4"
      >
        {/* Header */}
        <div
          onClick={() => toggleRequisition(req.req_id)}
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm font-medium text-blue-600">
              REQ-{req.req_id.toString().padStart(4, "0")}
            </span>
            <div>
              <div className="font-medium text-slate-800">
                {req.project_name || "Unnamed Project"}
              </div>
              {req.client_name && (
                <div className="text-xs text-slate-500">{req.client_name}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Budget Summary */}
            <div className="text-right">
              <div className="text-xs text-slate-500">Total Estimated</div>
              <div className="font-semibold">
                ₹{totalEstimated.toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Approved</div>
              <div className="font-semibold text-green-700">
                ₹{totalApproved.toLocaleString()}
              </div>
            </div>

            {/* Progress */}
            <div className="text-center">
              <div className="text-xs text-slate-500">Items</div>
              <div
                className={`font-semibold ${approvedCount === totalCount ? "text-green-700" : "text-amber-600"}`}
              >
                {approvedCount}/{totalCount}
              </div>
            </div>

            {/* Expand/Collapse */}
            {isExpanded ? (
              <ChevronUp size={20} className="text-slate-400" />
            ) : (
              <ChevronDown size={20} className="text-slate-400" />
            )}
          </div>
        </div>

        {/* Items Table */}
        {isExpanded && (
          <div className="border-t border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">
                    ID
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">
                    Position
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-600">
                    Estimated
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-slate-600">
                    Approved
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {req.items.map(renderItemRow)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <ShieldAlert size={48} className="text-red-400 mb-3" />
        <h3 className="text-lg font-semibold text-slate-800">Access Denied</h3>
        <p className="text-sm text-slate-500 mt-2">
          You don't have permission to manage budget approvals.
        </p>
      </div>
    );
  }

  return (
    <div className="master-data-manager">
      <div className="data-manager-header flex items-center justify-between">
        <div>
          <h2>Item Budget Approvals</h2>
          <p className="subtitle">
            Approve or reject budgets for individual requisition items
          </p>
        </div>
        <button
          onClick={loadPendingBudgetRequisitions}
          disabled={loading}
          className="action-button text-sm"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-4 py-3 flex items-center justify-between">
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            className="text-green-600 hover:text-green-800"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-800"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="animate-spin" size={20} />
          Loading pending budget approvals...
        </div>
      )}

      {/* Empty State */}
      {!loading && requisitions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-slate-300 mb-3">
            <CheckCircle size={56} />
          </div>
          <p className="text-slate-500 font-medium text-lg">All caught up!</p>
          <p className="text-slate-400 text-sm mt-1">
            No requisitions pending budget approval
          </p>
        </div>
      )}

      {/* Requisitions List */}
      <div className="mb-4 bg-white border border-slate-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Budget Approved By <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={budgetApprovedBy}
          onChange={(e) => setBudgetApprovedBy(e.target.value)}
          placeholder="Enter approver name"
          className="w-full md:w-96 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          Required for approving or saving approved budget from dashboard.
        </p>
      </div>

      {!loading &&
        requisitions.length > 0 &&
        requisitions.map(renderRequisitionCard)}

      {/* Edit Budget Modal */}
      {editModal.open && editModal.item && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">
                Set Approved Budget
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Item #{editModal.item.item_id} - {editModal.item.role_position}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Estimated Budget (Read-only)
                </label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
                  {getCurrencySymbol(editModal.item.currency)}
                  {(editModal.item.estimated_budget || 0).toLocaleString()}{" "}
                  {editModal.item.currency}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Approved Budget
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    {getCurrencySymbol(editModal.item.currency)}
                  </span>
                  <input
                    type="text"
                    value={editBudget}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, "");
                      setEditBudget(value);
                      setEditError(null);
                    }}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="50000"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  This will update approved budget only. Estimated budget
                  remains unchanged.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Budget Approved By <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={budgetApprovedBy}
                  onChange={(e) => {
                    setBudgetApprovedBy(e.target.value);
                    setEditError(null);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter approver name"
                />
              </div>

              {editError && (
                <div className="text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {editError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                disabled={editSubmitting}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {editSubmitting ? (
                  <Loader2 size={14} className="animate-spin mr-2 inline" />
                ) : null}
                Save Approved Budget
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Budget Modal - approved amount can differ from estimated */}
      {approveModal.open && approveModal.item && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-green-700">
                Approve Item Budget
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Item #{approveModal.item.item_id} -{" "}
                {approveModal.item.role_position}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Estimated (manager)
                </label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
                  {getCurrencySymbol(approveModal.item.currency)}
                  {(
                    approveModal.item.estimated_budget || 0
                  ).toLocaleString()}{" "}
                  {approveModal.item.currency}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Approved amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    {getCurrencySymbol(approveModal.item.currency)}
                  </span>
                  <input
                    type="text"
                    value={approveAmount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, "");
                      setApproveAmount(value);
                      setApproveError(null);
                    }}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="Same as estimated or enter different amount"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  You can approve at the estimated amount or enter a different
                  approved amount.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Budget Approved By <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={budgetApprovedBy}
                  onChange={(e) => {
                    setBudgetApprovedBy(e.target.value);
                    setApproveError(null);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Enter approver name"
                />
              </div>

              {approveError && (
                <div className="text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {approveError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={closeApproveModal}
                className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveSubmit}
                disabled={approveSubmitting}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {approveSubmitting ? (
                  <Loader2 size={14} className="animate-spin mr-2 inline" />
                ) : null}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Budget Modal */}
      {rejectModal.open && rejectModal.item && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-red-700">
                Reject Item Budget
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Item #{rejectModal.item.item_id} -{" "}
                {rejectModal.item.role_position}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={16}
                    className="text-amber-600 mt-0.5 flex-shrink-0"
                  />
                  <p className="text-sm text-amber-800">
                    Rejecting this budget will require the manager to revise the
                    estimated budget before it can be approved.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Rejection Reason (Required)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => {
                    setRejectReason(e.target.value);
                    setRejectError(null);
                  }}
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="Please provide a reason for rejection (min 10 characters)..."
                />
              </div>

              {rejectError && (
                <div className="text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {rejectError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={closeRejectModal}
                className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={
                  actionStates[rejectModal.item.item_id]?.rejecting || false
                }
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionStates[rejectModal.item.item_id]?.rejecting ? (
                  <Loader2 size={14} className="animate-spin mr-2 inline" />
                ) : (
                  <XCircle size={14} className="mr-2 inline" />
                )}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemBudgetApprovalPanel;
