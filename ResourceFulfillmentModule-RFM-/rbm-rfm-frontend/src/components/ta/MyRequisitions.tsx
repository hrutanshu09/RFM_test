import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../contexts/useAuth";
import { normalizeStatus, getStatusLabel } from "../../types/workflow";

/* ======================================================
   Types
   ====================================================== */

interface MyRequisition {
  id: string;
  project: string;
  role: string;
  status: string;
  priority: string;
  slaDaysRemaining: number;
}

interface BackendRequisitionItem {
  item_id: number;
  role_position: string;
  item_status: string;
}

interface BackendRequisition {
  req_id: number;
  project_name?: string | null;
  overall_status: string;
  priority?: string | null;
  created_at?: string | null;
  assigned_ta?: number | null;
  items: BackendRequisitionItem[];
}

const SLA_HOURS = 72;

/* ======================================================
   Props
   ====================================================== */

interface MyRequisitionsProps {
  onViewRequisition?: (reqId: string) => void;
}

/* ======================================================
   Helpers
   ====================================================== */

const getStatusClass = (status: MyRequisition["status"]) => {
  const normalized = normalizeStatus(status);
  switch (normalized) {
    case "Draft":
      return "open";
    case "Pending_Budget":
    case "Pending_HR":
    case "Active":
      return "in-progress";
    case "Fulfilled":
      return "fulfilled";
    case "Cancelled":
    case "Rejected":
      return "closed";
    default:
      return "";
  }
};

const getPriorityClass = (priority: MyRequisition["priority"]) => {
  switch (priority) {
    case "High":
      return "priority-high";
    case "Medium":
      return "priority-medium";
    case "Low":
      return "priority-low";
    default:
      return "";
  }
};

const getSlaClass = (days: number) => {
  if (days <= 3) return "critical";
  if (days <= 7) return "warning";
  return "";
};

const getSlaDaysRemaining = (dateValue?: string | null) => {
  if (!dateValue) return 0;
  const created = new Date(dateValue);
  const diffMs = Date.now() - created.getTime();
  const diffHours = Math.max(0, diffMs / 3600000);
  return Math.ceil((SLA_HOURS - diffHours) / 24);
};

/* ======================================================
   Component
   ====================================================== */

const MyRequisitions: React.FC<MyRequisitionsProps> = ({
  onViewRequisition,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? null;
  const [requisitions, setRequisitions] = useState<MyRequisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRequisitions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Phase 7: Add cache-busting to ensure fresh data after reassignment
        const response = await apiClient.get<BackendRequisition[]>(
          `/requisitions?assigned_to=me&_t=${Date.now()}`,
        );
        if (!isMounted) return;
        // Phase 7: Backend already filters by item-level assigned_ta,
        // so no need to filter by header-level assigned_ta here
        const mapped = (response.data ?? []).map((req) => {
          const primaryRole = req.items?.[0]?.role_position ?? "—";
          return {
            id: `REQ-${req.req_id}`,
            project: req.project_name ?? "—",
            role: primaryRole,
            status: req.overall_status ?? "—",
            priority: req.priority ?? "—",
            slaDaysRemaining: Math.max(
              0,
              getSlaDaysRemaining(req.created_at),
            ),
          };
        });
        setRequisitions(mapped);
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load requisitions";
        setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchRequisitions();
    
    // Phase 7: Listen for TA reassignment events to refresh the list
    const handleReassignment = () => {
      fetchRequisitions();
    };
    
    window.addEventListener("requisition-reassigned", handleReassignment);

    return () => {
      isMounted = false;
      window.removeEventListener("requisition-reassigned", handleReassignment);
    };
  }, [currentUserId]);

  const visibleRequisitions = useMemo(() => requisitions, [requisitions]);

  return (
    <>
      {/* Header */}
      <div className="manager-header">
        <h2>My Requisitions</h2>
        <p className="subtitle">Requisitions assigned to you</p>
      </div>

      {/* Table */}
      <div className="ticket-table-container">
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Req ID</th>
              <th>Project</th>
              <th>Role</th>
              <th>Status</th>
              <th>Priority</th>
              <th>SLA</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {visibleRequisitions.map((req) => (
              <tr key={req.id}>
                <td>
                  <strong>{req.id}</strong>
                </td>

                <td>{req.project}</td>

                <td>{req.role}</td>

                <td>
                  <span
                    className={`ticket-status ${getStatusClass(req.status)}`}
                  >
                    {getStatusLabel(req.status)}
                  </span>
                </td>

                <td>
                  <span
                    className={`priority-indicator ${getPriorityClass(
                      req.priority,
                    )}`}
                  >
                    {req.priority}
                  </span>
                </td>

                <td>
                  <span
                    className={`sla-timer ${getSlaClass(req.slaDaysRemaining)}`}
                  >
                    {req.slaDaysRemaining} days left
                  </span>
                </td>

                <td>
                  <button
                    className="action-button primary"
                    onClick={() => onViewRequisition?.(req.id)}
                  >
                    Continue Work
                  </button>
                </td>
              </tr>
            ))}

            {isLoading && (
              <tr>
                <td colSpan={7}>
                  <div className="tickets-empty-state">
                    Loading requisitions…
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={7}>
                  <div
                    className="tickets-empty-state"
                    style={{ color: "var(--error)" }}
                  >
                    {error}
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !error && visibleRequisitions.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="tickets-empty-state">
                    No requisitions assigned to you
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default MyRequisitions;
