import React, { useState } from "react";

interface AuditLog {
  id: number;
  requisitionId: string;
  action:
    | "CREATED"
    | "ITEM_ADDED"
    | "ITEM_UPDATED"
    | "HR_SELF_ASSIGNED"
    | "EMPLOYEE_ALLOCATED"
    | "ITEM_CANCELLED"
    | "REQUISITION_CLOSED";
  performedBy: string;
  performedAt: string;
}

const auditLogs: AuditLog[] = [
  {
    id: 1,
    requisitionId: "REQ-3001",
    action: "CREATED",
    performedBy: "Manager – Rahul Mehta",
    performedAt: "2024-01-10 10:15",
  },
  {
    id: 2,
    requisitionId: "REQ-3001",
    action: "ITEM_ADDED",
    performedBy: "Manager – Rahul Mehta",
    performedAt: "2024-01-10 10:18",
  },
  {
    id: 3,
    requisitionId: "REQ-3001",
    action: "HR_SELF_ASSIGNED",
    performedBy: "HR – Anita Sharma",
    performedAt: "2024-01-11 09:30",
  },
  {
    id: 4,
    requisitionId: "REQ-3001",
    action: "EMPLOYEE_ALLOCATED",
    performedBy: "HR – Anita Sharma",
    performedAt: "2024-01-15 16:45",
  },
  {
    id: 5,
    requisitionId: "REQ-3005",
    action: "ITEM_CANCELLED",
    performedBy: "HR – Kunal Verma",
    performedAt: "2024-01-19 11:20",
  },
];

const RequisitionAudit: React.FC = () => {
  const [reqInput, setReqInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [fromDateInput, setFromDateInput] = useState("");
  const [toDateInput, setToDateInput] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [reqFilter, setReqFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const applyFilters = () => {
    setReqFilter(reqInput.trim());
    setActionFilter(actionInput);
    setFromDate(fromDateInput);
    setToDate(toDateInput);
    setSearchFilter(searchInput.trim());
  };

  const resetFilters = () => {
    setReqInput("");
    setActionInput("");
    setFromDateInput("");
    setToDateInput("");
    setSearchInput("");
    setReqFilter("");
    setActionFilter("");
    setFromDate("");
    setToDate("");
    setSearchFilter("");
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (reqFilter && !log.requisitionId.includes(reqFilter)) return false;
    if (actionFilter && log.action !== actionFilter) return false;
    if (fromDate && log.performedAt < fromDate) return false;
    if (toDate && log.performedAt > toDate) return false;
    if (searchFilter) {
      const query = searchFilter.toLowerCase();
      const actionLabel = log.action.split("_").join(" ").toLowerCase();
      if (
        !log.requisitionId.toLowerCase().includes(query) &&
        !log.performedBy.toLowerCase().includes(query) &&
        !actionLabel.includes(query)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <>
      {/* Page Header */}
      <div className="manager-header">
        <h2>Requisition Audit</h2>
        <p className="subtitle">
          Complete, immutable audit trail for requisition activity
        </p>
      </div>

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-grid">
          <div className="filter-item">
            <label>Requisition ID</label>
            <input
              placeholder="REQ-3001"
              value={reqInput}
              onChange={(e) => setReqInput(e.target.value)}
            />
          </div>

          <div className="filter-item">
            <label>Action</label>
            <select
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
            >
              <option value="">All Actions</option>
              <option value="CREATED">Created</option>
              <option value="ITEM_ADDED">Item Added</option>
              <option value="ITEM_UPDATED">Item Updated</option>
              <option value="HR_SELF_ASSIGNED">HR Self Assigned</option>
              <option value="EMPLOYEE_ALLOCATED">Employee Allocated</option>
              <option value="ITEM_CANCELLED">Item Cancelled</option>
              <option value="REQUISITION_CLOSED">Requisition Closed</option>
            </select>
          </div>

          <div className="filter-item">
            <label>From Date</label>
            <input
              type="date"
              value={fromDateInput}
              onChange={(e) => setFromDateInput(e.target.value)}
            />
          </div>

          <div className="filter-item">
            <label>To Date</label>
            <input
              type="date"
              value={toDateInput}
              onChange={(e) => setToDateInput(e.target.value)}
            />
          </div>
        </div>

        <div className="filter-group">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search requisition, action, or user"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="action-button"
              type="button"
              onClick={applyFilters}
            >
              Apply Filters
            </button>
            <button
              className="action-button"
              type="button"
              onClick={resetFilters}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Audit Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Requisition ID</th>
              <th>Action</th>
              <th>Performed By</th>
              <th>Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id}>
                <td>
                  <strong>{log.requisitionId}</strong>
                </td>
                <td>
                  <span className="status-badge neutral">
                    {log.action.split("_").join(" ")}
                  </span>
                </td>
                <td>{log.performedBy}</td>
                <td>{log.performedAt}</td>
              </tr>
            ))}

            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="empty-state">
                    No audit records match the selected filters.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Compliance Note */}
      <div className="mt-4 text-xs text-slate-500">
        • This audit log is system-generated and immutable. • Entries cannot be
        edited or deleted by any role.
      </div>
    </>
  );
};

export default RequisitionAudit;
