import React, { useState } from "react";

/* ======================================================
   Types
   ====================================================== */

type AuditAction =
  | "SELF_ASSIGN"
  | "STATUS_CHANGE"
  | "BUDGET_UPDATE"
  | "ALLOCATION";

interface AuditLogEntry {
  id: string;
  requisitionId: string;
  action: AuditAction;
  performedBy: string;
  timestamp: string;
  details: string;
}

/* ======================================================
   Mock Data (Replace with API later)
   ====================================================== */

const auditLogs: AuditLogEntry[] = [
  {
    id: "AUD-001",
    requisitionId: "REQ-2001",
    action: "SELF_ASSIGN",
    performedBy: "Rahul Mehta",
    timestamp: "12-Jan-2026 09:32",
    details: "Requisition self-assigned by TA",
  },
  {
    id: "AUD-002",
    requisitionId: "REQ-2001",
    action: "STATUS_CHANGE",
    performedBy: "Rahul Mehta",
    timestamp: "13-Jan-2026 11:15",
    details: "Status changed from Open to In Progress",
  },
  {
    id: "AUD-003",
    requisitionId: "REQ-2001",
    action: "ALLOCATION",
    performedBy: "Rahul Mehta",
    timestamp: "18-Jan-2026 16:05",
    details: "Allocated internal employee RBM-021",
  },
  {
    id: "AUD-004",
    requisitionId: "REQ-1998",
    action: "BUDGET_UPDATE",
    performedBy: "Anita Sharma",
    timestamp: "19-Jan-2026 14:40",
    details: "Budget updated from ₹15L to ₹18L",
  },
];

/* ======================================================
   Helpers
   ====================================================== */

const getActionLabel = (action: AuditAction) => {
  switch (action) {
    case "SELF_ASSIGN":
      return "Self Assigned";
    case "STATUS_CHANGE":
      return "Status Change";
    case "BUDGET_UPDATE":
      return "Budget Update";
    case "ALLOCATION":
      return "Resource Allocation";
    default:
      return action;
  }
};

const getActionBadgeClass = (action: AuditAction) => {
  switch (action) {
    case "STATUS_CHANGE":
      return "priority-medium";
    case "BUDGET_UPDATE":
      return "priority-high";
    case "ALLOCATION":
      return "priority-low";
    case "SELF_ASSIGN":
      return "priority-low";
    default:
      return "";
  }
};

/* ======================================================
   Component
   ====================================================== */

const TAAuditLog: React.FC = () => {
  const [searchText, setSearchText] = useState("");

  const filteredLogs = auditLogs.filter(
    (log) =>
      log.requisitionId.toLowerCase().includes(searchText.toLowerCase()) ||
      log.performedBy.toLowerCase().includes(searchText.toLowerCase()) ||
      log.details.toLowerCase().includes(searchText.toLowerCase()),
  );

  return (
    <>
      {/* Header */}
      <div className="manager-header">
        <h2>TA Audit & Activity Log</h2>
        <p className="subtitle">Read-only audit trail for TA actions</p>
      </div>

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-group">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by requisition, user, or action"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="log-table-container">
        <table className="log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Requisition</th>
              <th>Action</th>
              <th>Performed By</th>
              <th>Details</th>
            </tr>
          </thead>

          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id}>
                <td>{log.timestamp}</td>

                <td>
                  <strong>{log.requisitionId}</strong>
                </td>

                <td>
                  <span
                    className={`priority-indicator ${getActionBadgeClass(
                      log.action,
                    )}`}
                  >
                    {getActionLabel(log.action)}
                  </span>
                </td>

                <td>{log.performedBy}</td>

                <td>{log.details}</td>
              </tr>
            ))}

            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-logs">No audit records found</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default TAAuditLog;
