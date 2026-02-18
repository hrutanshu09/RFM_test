import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import Header from "../Header";
import ManagerHeader from "./ManagerHeader";
import ManagerSidebar, { ManagerDashboardView } from "./ManagerSidebar";
import "../../styles/hr/hr-dashboard.css";
import "../../styles/manager/manager-dashboard.css";
import { getStatusLabel } from "../../types/workflow";
import RequisitionWizard from "./RequisitionWizard";
import MyRequisitions from "./MyRequisitions";
import RequisitionAudit from "./RequisitionAudit";
import { AlertTriangle, Clock, TrendingUp } from "lucide-react";
import { managerDashboardService } from "../../api/managerDashboardService";
import { ManagerDashboardMetrics } from "../../types/managerDashboard";

const viewLabels: Record<ManagerDashboardView, string> = {
  "manager-dashboard": "Dashboard",
  "raise-requisition": "Raise Requisition",
  "my-requisitions": "My Requisitions",
  "requisition-audit": "Requisition Audit",
};

const ManagerDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] =
    useState<ManagerDashboardView>("manager-dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [metrics, setMetrics] = useState<ManagerDashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isManager = useMemo(
    () => (user?.roles || []).includes("manager"),
    [user?.roles],
  );

  const activeLabel = useMemo(() => viewLabels[activeView], [activeView]);

  const goToView = (view: ManagerDashboardView) => {
    window.history.pushState(
      { managerView: view },
      "",
      window.location.pathname + window.location.search,
    );
    setActiveView(view);
  };

  useEffect(() => {
    if (window.history.state?.managerView == null) {
      window.history.replaceState(
        { managerView: activeView },
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const state = window.history.state as { managerView?: ManagerDashboardView } | undefined;
      setActiveView(state?.managerView ?? "manager-dashboard");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (user && !isManager) {
      navigate("/unauthorized", { replace: true });
    }
  }, [isManager, navigate, user]);

  useEffect(() => {
    if (!isManager || activeView !== "manager-dashboard") return;

    const controller = new AbortController();
    const loadMetrics = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await managerDashboardService.getMetrics(
          controller.signal,
        );
        setMetrics(data);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "CanceledError") return;

        let message = "Failed to load manager metrics";
        const axiosErr = err as { response?: { data?: { detail?: unknown } } };
        const detail = axiosErr?.response?.data?.detail;

        if (Array.isArray(detail)) {
          message = detail
            .map(
              (item: Record<string, unknown>) =>
                (item?.msg as string) || JSON.stringify(item),
            )
            .filter(Boolean)
            .join("\n");
        } else if (typeof detail === "string") {
          message = detail;
        }

        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();

    return () => controller.abort();
  }, [activeView, isManager]);

  const formattedMetrics = useMemo(() => {
    const avgDays = metrics?.avg_fulfillment_days ?? 0;
    const avgLabel = Number.isFinite(avgDays)
      ? avgDays.toFixed(1).replace(/\.0$/, "")
      : "0";

    return [
      {
        label: "Total Requisitions",
        value: metrics?.total_requisitions ?? 0,
      },
      { label: getStatusLabel("Active"), value: metrics?.open ?? 0 },
      { label: getStatusLabel("Pending_HR"), value: metrics?.in_progress ?? 0 },
      { label: getStatusLabel("Fulfilled"), value: metrics?.closed ?? 0 },
      { label: "Pending Positions", value: metrics?.pending_positions ?? 0 },
      { label: "Avg Fulfillment (Days)", value: avgLabel },
    ];
  }, [metrics]);

  const isEmptyDashboard = useMemo(() => {
    if (!metrics) return false;
    return (
      metrics.total_requisitions === 0 &&
      metrics.pending_positions === 0 &&
      metrics.sla_risks.length === 0 &&
      metrics.pending_positions_alerts.length === 0
    );
  }, [metrics]);

  /* ===== DASHBOARD VIEW ===== */
  const renderDashboard = () => (
    <>
      {isLoading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading manager metrics...</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <AlertTriangle size={32} />
          <p>{error}</p>
        </div>
      ) : isEmptyDashboard ? (
        <div className="empty-state">
          <Clock size={32} />
          <p>No requisition activity yet.</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="admin-metrics">
            {formattedMetrics.map((metric) => (
              <div key={metric.label} className="stat-card">
                <span className="stat-number">{metric.value}</span>
                <span className="stat-label">{metric.label}</span>
              </div>
            ))}
          </div>

          {/* Alerts */}
          <div className="audit-log-viewer" style={{ marginTop: "24px" }}>
            <div className="viewer-header">
              <h2>Alerts & Attention</h2>
              <p className="subtitle">Requisitions requiring review</p>
            </div>

            {metrics &&
            metrics.sla_risks.length === 0 &&
            metrics.pending_positions_alerts.length === 0 ? (
              <div className="empty-logs">No alerts at this time.</div>
            ) : (
              <div className="alert-row">
                {metrics?.sla_risks.map((risk) => (
                  <div
                    key={`sla-${risk.requisition_id}`}
                    className="alert-card"
                    onClick={() =>
                      navigate(`/manager/requisitions/${risk.requisition_id}`)
                    }
                  >
                    <div className="alert-card-left">
                      <AlertTriangle className="alert-icon--danger" size={18} />
                      <div>
                        <div className="alert-card-title">SLA Risk</div>
                        <div className="alert-card-detail">
                          REQ-{risk.requisition_id} open for {risk.days_open}{" "}
                          days
                        </div>
                      </div>
                    </div>
                    <button
                      className="alert-card-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(
                          `/manager/requisitions/${risk.requisition_id}`,
                        );
                      }}
                    >
                      Monitor
                    </button>
                  </div>
                ))}

                {metrics?.pending_positions_alerts.map((alert) => (
                  <div
                    key={`pending-${alert.requisition_id}`}
                    className="alert-card"
                    onClick={() =>
                      navigate(`/manager/requisitions/${alert.requisition_id}`)
                    }
                  >
                    <div className="alert-card-left">
                      <Clock className="alert-icon--warning" size={18} />
                      <div>
                        <div className="alert-card-title">
                          Pending Positions
                        </div>
                        <div className="alert-card-detail">
                          {alert.pending_count} positions pending in REQ-
                          {alert.requisition_id}
                        </div>
                      </div>
                    </div>
                    <button
                      className="alert-card-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(
                          `/manager/requisitions/${alert.requisition_id}`,
                        );
                      }}
                    >
                      Monitor
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Insight Footer */}
          <div className="insight-footer">
            <div className="insight-footer-inner">
              <TrendingUp size={18} />
              <div>
                <div className="insight-footer-title">Insight</div>
                <div className="insight-footer-text">
                  Most requisitions are progressing normally. SLA risks and
                  pending positions highlight items needing attention.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  /* ===== MAIN CONTENT SWITCH ===== */
  const renderContent = () => {
    switch (activeView) {
      case "manager-dashboard":
        return renderDashboard();
      case "raise-requisition":
        return <RequisitionWizard />;
      case "my-requisitions":
        return <MyRequisitions />;
      case "requisition-audit":
        return <RequisitionAudit />;
      default:
        return null;
    }
  };

  return (
    <div className={`admin-dashboard ${collapsed ? "sidebar-collapsed" : ""}`}>
      <ManagerSidebar
        activeView={activeView}
        onViewChange={goToView}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      <div
        className={`admin-main-content ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <Header />
        <ManagerHeader
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

export default ManagerDashboard;
