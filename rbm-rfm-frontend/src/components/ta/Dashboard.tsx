import React, { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import Header from "../Header";
import TAHeader from "./TAHeader";
import TASidebar from "./TASidebar";
import "../../styles/hr/hr-dashboard.css";
import Requisitions from "./Requisitions";
import MyRequisitions from "./MyRequisitions";
import RequisitionDetail from "./RequisitionDetail";
import ResourcePool from "./ResourcePool";
import TAReports from "./TAReports";
import TAAuditLog from "./TAAuditLog";
import { apiClient } from "../../api/client";
import {
  normalizeStatus,
  isTerminalStatus,
  getStatusLabel,
} from "../../types/workflow";

/* ======================================================
   View Labels
   ====================================================== */

const viewLabels: Record<string, string> = {
  dashboard: "Dashboard",
  requisitions: "Requisitions",
  "my-requisitions": "My Requisitions",
  "requisition-detail": "Requisition Detail",
  "resource-pool": "Resource Pool",
  "resume-screening": "Resume Screening",
  reports: "Reports",
  "audit-logs": "Audit Logs",
};

/* ======================================================
   Dashboard Types
   ====================================================== */

type TADashboardMetric = {
  key: string;
  label: string;
  value: number;
  variant: "neutral" | "warning" | "success" | "critical";
};

type TAAlert = {
  id: string;
  message: string;
  severity: "warning" | "critical";
};

interface BackendRequisition {
  req_id: number;
  overall_status: string;
  priority?: string | null;
  created_at?: string | null;
  assigned_ta?: number | null;
}

const SLA_HOURS = 72;

const getAgeHours = (dateValue?: string | null): number => {
  if (!dateValue || String(dateValue).trim() === "") return 0;
  const created = new Date(dateValue);
  if (Number.isNaN(created.getTime())) return 0;
  const diffMs = Date.now() - created.getTime();
  return Math.max(0, diffMs / 3600000);
};

const getDaysOpen = (dateValue?: string | null): number => {
  if (!dateValue || String(dateValue).trim() === "") return 0;
  const created = new Date(dateValue);
  if (Number.isNaN(created.getTime())) return 0;
  const diffMs = Math.max(0, Date.now() - created.getTime());
  return Math.ceil(diffMs / 86400000);
};

const getSlaDaysRemaining = (dateValue?: string | null): number => {
  const remainingHours = SLA_HOURS - getAgeHours(dateValue);
  return Math.ceil(remainingHours / 24);
};

/* ======================================================
   Component
   ====================================================== */

const isOpenStatus = (status?: string | null) =>
  !isTerminalStatus(normalizeStatus(status ?? ""));

const TADashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = user?.user_id ?? null;

  const [collapsed, setCollapsed] = useState(false);
  const [selectedRequisitionId, setSelectedRequisitionId] = useState<
    string | null
  >(null);
  const [requisitions, setRequisitions] = useState<BackendRequisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleAlertCount, setVisibleAlertCount] = useState(20);

  useEffect(() => {
    let isMounted = true;

    const fetchRequisitions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response =
          await apiClient.get<BackendRequisition[]>("/requisitions");
        if (isMounted) {
          setRequisitions(response.data ?? []);
        }
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

    return () => {
      isMounted = false;
    };
  }, []);

  const metrics = useMemo<TADashboardMetric[]>(() => {
    const open = requisitions.filter((req) =>
      isOpenStatus(req.overall_status),
    ).length;
    const inProgress = requisitions.filter(
      (req) => normalizeStatus(req.overall_status) === "Active",
    ).length;
    const assignedToMe = requisitions.filter(
      (req) => req.assigned_ta && req.assigned_ta === currentUserId,
    ).length;
    const avgFulfillmentDays = 0;

    return [
      {
        key: "open",
        label: "Open Requisitions",
        value: open,
        variant: "neutral",
      },
      {
        key: "inProgress",
        label: getStatusLabel("Active"),
        value: inProgress,
        variant: "warning",
      },
      {
        key: "assignedToMe",
        label: "Assigned to Me",
        value: assignedToMe,
        variant: "success",
      },
      // {
      //   key: "avgTime",
      //   label: "Avg Fulfillment Time (Days)",
      //   value: avgFulfillmentDays,
      //   variant: "neutral",
      // },
    ];
  }, [requisitions, currentUserId]);

  const alerts = useMemo<TAAlert[]>(() => {
    return requisitions
      .filter((req) => isOpenStatus(req.overall_status))
      .map((req) => {
        const daysOpen = getDaysOpen(req.created_at);
        const slaDays = getSlaDaysRemaining(req.created_at);
        if (daysOpen > 30) {
          return {
            id: `REQ-${req.req_id}`,
            message: `Requisition REQ-${req.req_id} aging over 30 days`,
            severity: "critical" as const,
          };
        }
        if (slaDays <= 2 && slaDays >= 0) {
          return {
            id: `REQ-${req.req_id}`,
            message: `REQ-${req.req_id} nearing SLA breach (${slaDays} day${slaDays === 1 ? "" : "s"} left)`,
            severity: "warning" as const,
          };
        }
        if (slaDays < 0) {
          return {
            id: `REQ-${req.req_id}`,
            message: `REQ-${req.req_id} SLA breached (${Math.abs(slaDays)} day${Math.abs(slaDays) === 1 ? "" : "s"} overdue)`,
            severity: "critical" as const,
          };
        }
        return null;
      })
      .filter(Boolean) as TAAlert[];
  }, [requisitions]);

  useEffect(() => {
    setVisibleAlertCount(20);
  }, [alerts.length]);

  const activeLabel = useMemo(() => {
    if (location.pathname.startsWith("/ta/requisitions/")) {
      return viewLabels["requisition-detail"];
    }
    if (location.pathname.startsWith("/ta/requisitions")) {
      return viewLabels["requisitions"];
    }
    if (location.pathname.startsWith("/ta/my-requisitions")) {
      return viewLabels["my-requisitions"];
    }
    if (location.pathname.startsWith("/ta/resource-pool")) {
      return viewLabels["resource-pool"];
    }
    if (location.pathname.startsWith("/ta/resume-screening")) {
      return viewLabels["resume-screening"];
    }
    return viewLabels["dashboard"];
  }, [location.pathname]);

  /* ======================================================
     Dashboard Render
     ====================================================== */

  const renderDashboard = () => (
    <>
      {/* KPI GRID */}
      <div className="tickets-kpi-grid">
        {metrics.map((metric) => (
          <div key={metric.key} className={`ticket-kpi-card ${metric.variant}`}>
            <div className="kpi-number">{metric.value}</div>
            <div className="kpi-label">{metric.label}</div>
          </div>
        ))}
      </div>

      {/* ALERTS & SLA RISKS */}
      <div className="stat-card" style={{ marginTop: 24 }}>
        <div className="manager-header">
          <h2>Alerts & SLA Risks</h2>
          <p className="subtitle">Requisitions requiring immediate attention</p>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <p>Loading alerts…</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p>{error}</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="empty-state">
            <p>No alerts at the moment</p>
          </div>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {alerts.slice(0, visibleAlertCount).map((alert) => (
                <li
                  key={alert.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 0",
                    borderBottom: "1px solid var(--border-light)",
                  }}
                >
                  <span>{alert.message}</span>

                  {alert.severity === "critical" ? (
                    <span className="aging-indicator aging-30-plus">
                      Critical
                    </span>
                  ) : (
                    <span className="sla-timer warning">SLA Warning</span>
                  )}
                </li>
              ))}
            </ul>

            {alerts.length > visibleAlertCount && (
              <div
                style={{
                  marginTop: "16px",
                  display: "flex",
                  justifyContent: "center",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <button
                  type="button"
                  className="action-button"
                  onClick={() =>
                    setVisibleAlertCount((prev) => prev + 20)
                  }
                >
                  Load more alerts
                </button>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                  }}
                >
                  Showing {visibleAlertCount} of {alerts.length} alerts
                </span>
              </div>
            )}

            {alerts.length > 0 &&
              alerts.length <= visibleAlertCount && (
                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    textAlign: "center",
                  }}
                >
                  Showing all {alerts.length} alerts
                </div>
              )}
          </>
        )}
      </div>
    </>
  );

  /* ======================================================
     Navigation Handlers & Browser Back Support
     ====================================================== */

  const handleViewDetail = (reqId: string) => {
    setSelectedRequisitionId(reqId);
    navigate(`/ta/requisitions/${reqId}`);
  };

  /* ======================================================
     Layout
     ====================================================== */

  return (
    <div className={`admin-dashboard ${collapsed ? "sidebar-collapsed" : ""}`}>
      <TASidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      <div
        className={`admin-main-content ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <Header />

        <TAHeader
          title={activeLabel ?? "Dashboard"}
          user={user}
          onLogout={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        />

        <section className="admin-content-area">
          {location.pathname === "/ta" ? (
            renderDashboard()
          ) : location.pathname === "/ta/requisitions" ? (
            <Requisitions onViewRequisition={handleViewDetail} />
          ) : location.pathname === "/ta/my-requisitions" ? (
            <MyRequisitions onViewRequisition={handleViewDetail} />
          ) : location.pathname.startsWith("/ta/requisitions/") ? (
            <RequisitionDetail
              requisitionId={selectedRequisitionId}
              onBack={() => navigate(-1)}
            />
          ) : location.pathname === "/ta/resource-pool" ? (
            <ResourcePool />
          ) : location.pathname === "/ta/reports" ? (
            <TAReports />
          ) : location.pathname === "/ta/audit-logs" ? (
            <TAAuditLog />
          ) : (
            <Outlet />
          )}
        </section>
      </div>
    </div>
  );
};

export default TADashboard;


