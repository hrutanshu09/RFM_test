/**
 * HRPendingApprovals.tsx
 * Fully wired HR pending approvals table with approve/reject workflow.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Eye, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { useAuth } from "../../contexts/useAuth";
import {
  hrDashboardService,
  HRPendingApprovalItem,
} from "../../api/hrDashboardService";
import { approveHR, rejectRequisition } from "../../api/workflowApi";
import { normalizeStatus } from "../../types/workflow";

interface HRPendingApprovalsProps {
  onViewRequisition?: (reqId: number) => void;
  onActionComplete?: () => void;
}

interface ActionState {
  approving: boolean;
  rejecting: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const HRPendingApprovals: React.FC<HRPendingApprovalsProps> = ({
  onViewRequisition,
  onActionComplete,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [pending, setPending] = useState<HRPendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, ActionState>>(
    {},
  );
  const [message, setMessage] = useState<string | null>(null);

  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    reqId: number | null;
  }>({ open: false, reqId: null });
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const hasAccess = useMemo(() => {
    const roles = (user?.roles || []).map((role) => role.toLowerCase());
    return roles.includes("hr") || roles.includes("admin");
  }, [user?.roles]);

  const loadPendingApprovals = useCallback(async () => {
    if (!hasAccess) return;

    const controller = new AbortController();

    try {
      setLoading(true);
      setError(null);
      const data = await hrDashboardService.getPendingApprovals(
        controller.signal,
      );
      setPending(data);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const detail = axiosErr?.response?.data?.detail;
      let messageText = "Failed to load pending approvals";

      if (Array.isArray(detail)) {
        messageText = detail
          .map(
            (item: Record<string, unknown>) =>
              (item?.msg as string) || JSON.stringify(item),
          )
          .filter(Boolean)
          .join("\n");
      } else if (typeof detail === "string") {
        messageText = detail;
      }

      setError(messageText);
    } finally {
      setLoading(false);
    }

    return () => controller.abort();
  }, [hasAccess]);

  useEffect(() => {
    if (hasAccess) {
      loadPendingApprovals();
    }
  }, [hasAccess, loadPendingApprovals]);

  const handleView = useCallback(
    (reqId: number) => {
      if (onViewRequisition) {
        onViewRequisition(reqId);
        return;
      }
      navigate(`/hr/requisitions/${reqId}`);
    },
    [navigate, onViewRequisition],
  );

  const handleApprove = useCallback(
    async (approval: HRPendingApprovalItem) => {
      if (normalizeStatus(approval.status) !== "Pending_HR") return;

      const key = approval.requisition_id;
      setActionState((prev) => ({
        ...prev,
        [key]: { approving: true, rejecting: false },
      }));

      try {
        await approveHR(Number(approval.requisition_id));
        setPending((prev) =>
          prev.filter(
            (item) => item.requisition_id !== approval.requisition_id,
          ),
        );
        setMessage("Requisition approved successfully");
        onActionComplete?.();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: unknown } } };
        const detail = axiosErr?.response?.data?.detail;
        let messageText = "Failed to approve requisition";

        if (Array.isArray(detail)) {
          messageText = detail
            .map(
              (item: Record<string, unknown>) =>
                (item?.msg as string) || JSON.stringify(item),
            )
            .filter(Boolean)
            .join("\n");
        } else if (typeof detail === "string") {
          messageText = detail;
        }

        setError(messageText);
      } finally {
        setActionState((prev) => ({
          ...prev,
          [key]: { approving: false, rejecting: false },
        }));
      }
    },
    [onActionComplete],
  );

  const openRejectModal = useCallback((reqId: number) => {
    setRejectModal({ open: true, reqId });
    setRejectReason("");
    setRejectError(null);
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectModal({ open: false, reqId: null });
    setRejectReason("");
    setRejectError(null);
  }, []);

  const handleReject = useCallback(async () => {
    if (!rejectModal.reqId) return;
    if (rejectReason.trim().length < 10) {
      setRejectError("Reason must be at least 10 characters.");
      return;
    }

    const key = rejectModal.reqId.toString();
    setActionState((prev) => ({
      ...prev,
      [key]: { approving: false, rejecting: true },
    }));

    try {
      await rejectRequisition(rejectModal.reqId, rejectReason.trim());
      setPending((prev) => prev.filter((item) => item.requisition_id !== key));
      setMessage("Requisition rejected successfully");
      closeRejectModal();
      onActionComplete?.();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const detail = axiosErr?.response?.data?.detail;
      let messageText = "Failed to reject requisition";

      if (Array.isArray(detail)) {
        messageText = detail
          .map(
            (item: Record<string, unknown>) =>
              (item?.msg as string) || JSON.stringify(item),
          )
          .filter(Boolean)
          .join("\n");
      } else if (typeof detail === "string") {
        messageText = detail;
      }

      setRejectError(messageText);
    } finally {
      setActionState((prev) => ({
        ...prev,
        [key]: { approving: false, rejecting: false },
      }));
    }
  }, [closeRejectModal, onActionComplete, rejectModal.reqId, rejectReason]);

  const renderContent = () => {
    if (!hasAccess) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <ShieldAlert size={48} className="text-red-400 mb-3" />
          <h3 className="text-lg font-semibold text-slate-800">
            Access Denied
          </h3>
          <p className="text-sm text-slate-500 mt-2">
            You don’t have permission to view HR approvals.
          </p>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="animate-spin" size={16} />
          Loading pending approvals...
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-sm text-red-600">
          {error}
          <button className="action-button ml-3" onClick={loadPendingApprovals}>
            Retry
          </button>
        </div>
      );
    }

    if (pending.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="text-slate-300 mb-3">
            <CheckCircle size={48} />
          </div>
          <p className="text-slate-500 font-medium">All caught up!</p>
          <p className="text-slate-400 text-sm">
            No requisitions pending HR approval
          </p>
        </div>
      );
    }

    return (
      <div className="data-table-container">
        <div className="table-scroll">
          <table className="data-table table-no-wrap">
            <thead>
              <tr>
                <th>Requisition ID</th>
                <th>Project</th>
                <th>Manager</th>
                <th>Requested Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((approval) => {
                const actionKey = approval.requisition_id;
                const action = actionState[actionKey] || {
                  approving: false,
                  rejecting: false,
                };
                const isDisabled =
                  (approval.status !== "Pending_HR" &&
                    approval.status !== "Pending HR Approval") ||
                  action.approving ||
                  action.rejecting;

                return (
                  <tr key={approval.requisition_id}>
                    <td>
                      <span className="font-mono text-sm text-blue-600">
                        REQ-
                        {approval.requisition_id.toString().padStart(4, "0")}
                      </span>
                    </td>
                    <td>
                      <div
                        className="font-medium truncate-cell"
                        title={approval.project_name || "—"}
                      >
                        {approval.project_name || "—"}
                      </div>
                    </td>
                    <td>{approval.manager_name || "—"}</td>
                    <td>{formatDate(approval.requested_date)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          className="action-button text-sm py-1 px-3"
                          onClick={() =>
                            handleView(Number(approval.requisition_id))
                          }
                        >
                          <Eye size={14} className="mr-1" />
                          View
                        </button>
                        <button
                          className="action-button primary text-sm py-1 px-3"
                          onClick={() => handleApprove(approval)}
                          disabled={isDisabled}
                        >
                          {action.approving ? (
                            <Loader2 size={14} className="mr-1 animate-spin" />
                          ) : (
                            <CheckCircle size={14} className="mr-1" />
                          )}
                          Approve
                        </button>
                        <button
                          className="action-button danger text-sm py-1 px-3"
                          onClick={() =>
                            openRejectModal(Number(approval.requisition_id))
                          }
                          disabled={isDisabled}
                        >
                          <XCircle size={14} className="mr-1" />
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="master-data-manager">
      <div className="data-manager-header">
        <h2>Pending HR Approvals</h2>
        <p className="subtitle">
          Requisitions awaiting your review ({pending.length})
        </p>
      </div>

      {message && (
        <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          {message}
        </div>
      )}

      {renderContent()}

      {rejectModal.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Reject Requisition</h3>
            </div>
            <div className="modal-body">
              <p className="text-sm text-slate-600 mb-3">
                Please provide a justification for rejecting this requisition.
              </p>
              <textarea
                className="w-full"
                rows={4}
                value={rejectReason}
                onChange={(event) => {
                  setRejectReason(event.target.value);
                  setRejectError(null);
                }}
                placeholder="Enter rejection reason (min 10 characters)"
              />
              {rejectError && (
                <div className="text-sm text-red-600 mt-2">{rejectError}</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="action-button" onClick={closeRejectModal}>
                Cancel
              </button>
              <button
                className="action-button danger"
                onClick={handleReject}
                disabled={
                  actionState[rejectModal.reqId?.toString() || ""]?.rejecting
                }
              >
                {actionState[rejectModal.reqId?.toString() || ""]?.rejecting ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <XCircle size={16} className="mr-2" />
                )}
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HRPendingApprovals;
