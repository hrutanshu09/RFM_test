// components/hr/HrAuditLog.tsx
import React from "react";

interface AuditRecord {
  id: number;
  employeeId: string;
  employeeName: string;
  entity: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  performedBy: string;
  date: string;
}

const auditLogs: AuditRecord[] = [
  {
    id: 1,
    employeeId: "RBM-001",
    employeeName: "Amit Sharma",
    entity: "Employee Core",
    action: "UPDATE",
    performedBy: "HR Admin",
    date: "2025-01-10",
  },
  {
    id: 2,
    employeeId: "RBM-002",
    employeeName: "Neha Verma",
    entity: "Skills",
    action: "CREATE",
    performedBy: "HR Executive",
    date: "2025-01-12",
  },
  {
    id: 3,
    employeeId: "RBM-003",
    employeeName: "Rohit Kulkarni",
    entity: "Contact Details",
    action: "UPDATE",
    performedBy: "HR Admin",
    date: "2025-01-15",
  },
];

const HrAuditLog: React.FC = () => {
  return (
    <>
      {/* Page Header
      <div className="manager-header">
        <h2>Audit Log</h2>
        <p className="subtitle">
          HR-scoped employee data change history for compliance and
          traceability.
        </p>
      </div> */}

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-grid">
          <div className="filter-item">
            <label>Employee</label>
            <input type="text" placeholder="Employee name or ID" />
          </div>

          <div className="filter-item">
            <label>Action</label>
            <select>
              <option value="">All</option>
              <option>CREATE</option>
              <option>UPDATE</option>
              <option>DELETE</option>
            </select>
          </div>

          <div className="filter-item">
            <label>Date</label>
            <input type="date" />
          </div>
        </div>

        <div className="filter-actions">
          <button className="action-button primary">Apply Filters</button>
        </div>
      </div>

      {/* Audit Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Entity</th>
              <th>Action</th>
              <th>Performed By</th>
            </tr>
          </thead>

          <tbody>
            {auditLogs.map((log) => (
              <tr key={log.id}>
                <td>{log.date}</td>

                <td>
                  <strong>{log.employeeName}</strong>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    {log.employeeId}
                  </div>
                </td>

                <td>{log.entity}</td>

                <td>
                  <span
                    className={`status-badge ${
                      log.action === "CREATE"
                        ? "active"
                        : log.action === "DELETE"
                          ? "inactive"
                          : ""
                    }`}
                  >
                    {log.action}
                  </span>
                </td>

                <td>{log.performedBy}</td>
              </tr>
            ))}

            {auditLogs.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-logs">
                    No audit records found for the selected filters.
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

export default HrAuditLog;
