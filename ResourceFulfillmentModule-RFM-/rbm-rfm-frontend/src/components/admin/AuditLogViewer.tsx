// rbm-rfm-frontend/src/components/admin/AuditLogViewer.tsx
import React, { useState, useEffect } from "react";
import {
  Search,
  Filter,
  Download,
  Eye,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { apiClient } from "../../api/client";

interface AuditLog {
  id: number;
  timestamp: string;
  userId?: number | null;
  user: string;
  userFullName?: string;
  userRoles?: string[];
  targetUserName?: string;
  targetUserFullName?: string;
  action: string;
  entityType: "employee" | "requisition" | "user" | "role" | "system";
  entityId: number;
  entityName: string;
  oldValue: string;
  newValue: string;
}

type AuditLogResponse = {
  audit_id: number;
  entity_name: string;
  entity_id: string | null;
  action: string;
  performed_by: number | null;
  performed_at: string;
  performed_by_username?: string | null;
  performed_by_full_name?: string | null;
  performed_by_roles?: string[];
  target_user_id?: number | null;
  target_user_username?: string | null;
  target_user_full_name?: string | null;
};

type AuditSummaryResponse = {
  total_logs: number;
  warnings_errors: number;
  active_users: number;
  failed_logins: number;
};

const normalizeAudit = (log: AuditLogResponse): AuditLog => ({
  id: log.audit_id,
  timestamp: log.performed_at,
  userId: log.performed_by ?? null,
  user: log.performed_by_username || log.performed_by?.toString() || "System",
  userFullName: log.performed_by_full_name || undefined,
  userRoles: log.performed_by_roles || undefined,
  targetUserName: log.target_user_username || undefined,
  targetUserFullName: log.target_user_full_name || undefined,
  action: log.action,
  entityType: "system",
  entityId: log.entity_id ? Number(log.entity_id) : 0,
  entityName: log.entity_name,
  oldValue: "",
  newValue: "",
});

const AuditLogViewer: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AuditSummaryResponse>({
    total_logs: 0,
    warnings_errors: 0,
    active_users: 0,
    failed_logins: 0,
  });
  const [filters, setFilters] = useState({
    search: "",
    dateFrom: "",
    dateTo: "",
    user: "",
    action: "",
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchSummary = async () => {
    try {
      const response = await apiClient.get<AuditSummaryResponse>(
        "/audit-logs/summary",
        {
          params: {
            search: debouncedSearch || undefined,
            date_from: filters.dateFrom || undefined,
            date_to: filters.dateTo || undefined,
            user_id: filters.user || undefined,
            action: filters.action || undefined,
          },
        },
      );
      setSummary(response.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load audit summary";
      setError(message);
    }
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<
        AuditLogResponse[] | { logs: AuditLogResponse[] }
      >("/audit-logs/", {
        params: {
          search: debouncedSearch || undefined,
          date_from: filters.dateFrom || undefined,
          date_to: filters.dateTo || undefined,
          user_id: filters.user || undefined,
          action: filters.action || undefined,
        },
      });
      const raw = Array.isArray(response.data)
        ? response.data
        : response.data.logs || [];
      const mapped = raw.map(normalizeAudit);
      setLogs(mapped);
      setFilteredLogs(mapped);
      await fetchSummary();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load audit logs";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  useEffect(() => {
    fetchLogs();
  }, [debouncedSearch]);

  const applyFilters = () => {
    fetchLogs();
  };

  const resetFilters = () => {
    setFilters({
      search: "",
      dateFrom: "",
      dateTo: "",
      user: "",
      action: "",
    });
    setDebouncedSearch("");
    fetchLogs();
  };

  const handleRefresh = () => {
    fetchLogs();
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await apiClient.get("/audit-logs/export", {
        params: {
          date_from: filters.dateFrom || undefined,
          date_to: filters.dateTo || undefined,
        },
        responseType: "blob",
      });

      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      const contentDisposition = response.headers["content-disposition"] as
        | string
        | undefined;
      const match = contentDisposition?.match(/filename=([^;]+)/i);
      const filename = match?.[1]?.replace(/"/g, "") || "audit-log.pdf";

      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to export audit logs";
      setError(message);
    } finally {
      setIsExporting(false);
    }
  };

  const formatDetails = (log: AuditLog) => {
    const targetName =
      log.targetUserFullName || log.targetUserName || "the user";

    if (log.action === "USER_VIEW") {
      return "Viewed user list";
    }

    if (log.action === "USER_ROLE_UPDATE") {
      return `Assigned role changes to user ${targetName}`;
    }

    if (log.action === "USER_DELETE") {
      return `Marked user ${targetName} as inactive`;
    }

    if (log.action === "USER_EDIT") {
      return `Updated user ${targetName}`;
    }

    return `${log.action} ${log.entityName}`.trim();
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "CREATE":
        return "🆕";
      case "UPDATE":
        return "✏️";
      case "DELETE":
        return "🗑️";
      case "LOGIN":
        return "🔐";
      case "LOGOUT":
        return "🚪";
      default:
        return "📝";
    }
  };

  return (
    <div className="audit-log-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2>Audit Log Review</h2>
          <p className="subtitle">
            Track all system changes and user activities
          </p>
        </div>
        <div className="header-actions">
          <button
            className="action-button"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw size={16} />
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="action-button"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={16} />
            {isExporting ? "Exporting..." : "Export Logs"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-group">
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search logs..."
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
            />
          </div>
        </div>

        <div className="filter-grid">
          <div className="filter-item">
            <label>From Date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
            />
          </div>
          <div className="filter-item">
            <label>To Date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
            />
          </div>
          <div className="filter-item">
            <label>User</label>
            <select
              value={filters.user}
              onChange={(e) => setFilters({ ...filters, user: e.target.value })}
            >
              <option value="">All Users</option>
              {Array.from(
                new Map(
                  logs.map((log) => {
                    const name = log.userFullName || log.user;
                    const roles = log.userRoles?.length
                      ? log.userRoles.join(", ")
                      : "-";
                    const label = `${name} (${roles})`;
                    const value =
                      log.userId !== null && log.userId !== undefined
                        ? log.userId.toString()
                        : "system";
                    return [value, { value, label }];
                  }),
                ).values(),
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>Action</label>
            <select
              value={filters.action}
              onChange={(e) =>
                setFilters({ ...filters, action: e.target.value })
              }
            >
              <option value="">All Actions</option>
              {[...new Set(logs.map((log) => log.action))].map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className="filter-actions"
          role="group"
          aria-label="Filter actions"
        >
          <button className="apply-filters-button" onClick={applyFilters}>
            <Filter size={16} />
            Apply Filters
          </button>
          <button className="apply-filters-button" onClick={resetFilters}>
            <RefreshCw size={16} />
            Reset Filters
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="log-stats">
        <div className="stat-card">
          <span className="stat-number">{summary.total_logs}</span>
          <span className="stat-label">Total Logs</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{summary.warnings_errors}</span>
          <span className="stat-label">Warnings & Errors</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{summary.active_users}</span>
          <span className="stat-label">Active Users</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{summary.failed_logins}</span>
          <span className="stat-label">Failed Logins</span>
        </div>
        {/* <div className="stat-card">
          <span className="stat-number">
            {logs.filter((l) => l.action === "LOGIN_FAILED").length}
          </span>
          <span className="stat-label">Failed Logins</span>
        </div> */}
      </div>

      {/* Log Table */}
      <div className="log-table-container">
        <table className="log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="table-loading">
                  Loading audit logs...
                </td>
              </tr>
            )}
            {filteredLogs.map((log) => (
              <tr key={log.id} className="log-row">
                <td className="timestamp">
                  <div className="date">
                    {new Date(log.timestamp).toLocaleDateString()}
                  </div>
                  <div className="time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </td>
                <td className="user-cell">
                  <span className="user-badge">
                    {log.userFullName || log.user}
                    {log.userRoles?.length
                      ? ` (${log.userRoles.join(", ")})`
                      : ""}
                  </span>
                </td>
                <td className="action-cell">
                  <span className="action-icon">
                    {getActionIcon(log.action)}
                  </span>
                  {log.action}
                </td>
                <td className="entity-cell">
                  <div className="entity-type">{log.entityType}</div>
                  <div className="entity-name">{log.entityName}</div>
                </td>
                <td className="details-cell">
                  <div className="change-summary">{formatDetails(log)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filteredLogs.length === 0 && (
          <div className="empty-logs">
            <AlertTriangle size={48} />
            <p>{error ?? "No audit logs found matching your filters"}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogViewer;
