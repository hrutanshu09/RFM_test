import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import { apiClient } from "../../api/client";

interface Requisition {
  req_id: number;
  project_name: string;
  client_name: string | null;
  overall_status: string;
  required_by_date: string;
  priority: string;
  budget_amount: number;
  created_at: string;
}

const MyRequisitions: React.FC = () => {
  const navigate = useNavigate();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRequisitions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await apiClient.get<Requisition[]>("/requisitions/my");
        if (isMounted) {
          setRequisitions(response.data);
        }
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load requisitions";
        setError(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchRequisitions();

    return () => {
      isMounted = false;
    };
  }, []);

  const formatDate = (value: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatCurrency = (value: number) => {
    if (Number.isNaN(value)) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusBadgeClass = (status: string) => {
    if (
      status === "Pending Budget Approval" ||
      status === "Pending HR Approval"
    ) {
      return "status-badge inactive";
    }
    if (status === "Approved & Unassigned" || status === "In-Progress") {
      return "status-badge active";
    }
    return `status-badge ${status.toLowerCase().replace(/\s+/g, "-")}`;
  };
  return (
    <>
      {/* Page Header */}
      <div className="manager-header">
        <h2>My Requisitions</h2>
        <p className="subtitle">
          Track progress of the demands you have raised.
        </p>
      </div>

      {/* Requisitions Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Req ID</th>
              <th>Project</th>
              <th>Client</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Required By</th>
              <th>Budget</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">Loading requisitions…</div>
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={9}>
                  <div
                    className="empty-state"
                    style={{ color: "var(--error)" }}
                  >
                    {error}
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !error && requisitions.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">No requisitions found.</div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              requisitions.map((req) => (
                <tr key={req.req_id}>
                  <td>
                    <strong>REQ-{req.req_id}</strong>
                  </td>
                  <td>{req.project_name || "—"}</td>
                  <td>{req.client_name || "—"}</td>
                  <td>
                    <span className={getStatusBadgeClass(req.overall_status)}>
                      {req.overall_status}
                    </span>
                  </td>
                  <td>{req.priority || "—"}</td>
                  <td>{formatDate(req.required_by_date)}</td>
                  <td>{formatCurrency(req.budget_amount)}</td>
                  <td>{formatDate(req.created_at)}</td>
                  <td>
                    <button
                      className="action-button text-sm"
                      onClick={() =>
                        navigate(`/manager/requisitions/${req.req_id}`)
                      }
                    >
                      <Eye size={14} />
                      View
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Authority Notice */}
      <div className="mt-4 text-xs text-slate-500">
        • This view is read-only. • Item status, assignments, and closure are
        handled by HR / TA.
      </div>
    </>
  );
};

export default MyRequisitions;
