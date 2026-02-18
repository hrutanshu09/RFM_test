import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import Header from "../Header";
import TAHeader from "./TAHeader";
import TASidebar, { TADashboardView } from "./TASidebar";
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

const viewLabels: Record<TADashboardView, string> = {
  dashboard: "Dashboard",
  requisitions: "Requisitions",
  "my-requisitions": "My Requisitions",
  "requisition-detail": "Requisition Detail",
  "resource-pool": "Resource Pool",
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

const getAgeHours = (dateValue?: string | null) => {
  if (!dateValue) return 0;
  const created = new Date(dateValue);
  const diffMs = Date.now() - created.getTime();
  return Math.max(0, diffMs / 3600000);
};

const getDaysOpen = (dateValue?: string | null) => {
  if (!dateValue) return 0;
  const created = new Date(dateValue);
  const diffMs = Math.max(0, Date.now() - created.getTime());
  return Math.ceil(diffMs / 86400000);
};

const getSlaDaysRemaining = (dateValue?: string | null) => {
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
  const currentUserId = user?.user_id ?? null;

  const [activeView, setActiveView] = useState<TADashboardView>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRequisitionId, setSelectedRequisitionId] = useState<
    string | null
  >(null);
  const [requisitions, setRequisitions] = useState<BackendRequisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      {
        key: "avgTime",
        label: "Avg Fulfillment Time (Days)",
        value: avgFulfillmentDays,
        variant: "neutral",
      },
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
        if (slaDays <= 2) {
          return {
            id: `REQ-${req.req_id}`,
            message: `REQ-${req.req_id} nearing SLA breach (${Math.max(
              0,
              slaDays,
            )} days left)`,
            severity: "warning" as const,
          };
        }
        return null;
      })
      .filter(Boolean) as TAAlert[];
  }, [requisitions]);

  const activeLabel = useMemo(() => viewLabels[activeView], [activeView]);

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
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {alerts.map((alert) => (
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
        )}
      </div>
    </>
  );

  /* ======================================================
     Navigation Handlers & Browser Back Support
     ====================================================== */

  const goToView = (view: TADashboardView, requisitionId?: string | null) => {
    const payload = {
      taView: view,
      requisitionId: requisitionId ?? null,
    };
    window.history.pushState(
      payload,
      "",
      window.location.pathname + window.location.search,
    );
    setActiveView(view);
    setSelectedRequisitionId(requisitionId ?? null);
  };

  const handleViewDetail = (reqId: string) => {
    goToView("requisition-detail", reqId);
  };

  useEffect(() => {
    if (window.history.state?.taView == null) {
      window.history.replaceState(
        { taView: activeView, requisitionId: selectedRequisitionId },
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const state = window.history.state as
        | { taView?: TADashboardView; requisitionId?: string | null }
        | undefined;
      const view = state?.taView ?? "dashboard";
      const id = state?.requisitionId ?? null;
      setActiveView(view);
      setSelectedRequisitionId(id);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const renderContent = () => {
    switch (activeView) {
      case "dashboard":
        return renderDashboard();

      case "requisitions":
        return <Requisitions onViewRequisition={handleViewDetail} />;

      case "my-requisitions":
        return <MyRequisitions onViewRequisition={handleViewDetail} />;

      case "requisition-detail":
        return (
          <RequisitionDetail
            requisitionId={selectedRequisitionId}
            onBack={() => window.history.back()}
          />
        );

      case "resource-pool":
        return <ResourcePool />;

      case "reports":
        return <TAReports />;

      case "audit-logs":
        return <TAAuditLog />;

      default:
        return null;
    }
  };

  /* ======================================================
     Layout
     ====================================================== */

  return (
    <div className={`admin-dashboard ${collapsed ? "sidebar-collapsed" : ""}`}>
      <TASidebar
        activeView={activeView}
        onViewChange={(view) => goToView(view)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      <div
        className={`admin-main-content ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <Header />

        <TAHeader
          title={activeLabel}
          user={user}
          onLogout={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        />

        <section className="admin-content-area">{renderContent()}</section>
      </div>
    </div>
  );
};

export default TADashboard;
