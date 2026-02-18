import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import Header from "../Header";
import HrHeader from "./HRHeader";
import HrSidebar, { HrDashboardView } from "./HRSidebar";
import "../../styles/hr/hr-dashboard.css";
import EmployeeList from "./EmployeeList";
import CreateEmployee from "./CreateEmployee";
import EmployeeProfile from "./EmployeeProfile";
import OnboardingTracker from "./OnboardingTracker";
import BenchAvailability from "./BenchAvailability";
import SkillsOverview from "./SkillsOverview";
import HrReports from "./HrReports";
import HrAuditLog from "./HrAuditLog";
import HrRequisitions from "./HrTickets";
import TicketDetails from "./TicketDetails";
import HRDashboardView from "./HRDashboardView";
const viewLabels: Record<HrDashboardView, string> = {
  dashboard: "Dashboard",
  employees: "Employees",
  "create-employee": "Create Employee",
  "employee-profile": "Employee Profile",
  onboarding: "Onboarding",
  "bench-availability": "Bench & Availability",
  skills: "Skills",
  reports: "Reports",
  "audit-logs": "Audit Logs",
  ticket: "Requisitions",
  "ticket-detail": "Requisition Details",
};

const HrDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<HrDashboardView>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const activeLabel = useMemo(() => viewLabels[activeView], [activeView]);

  const goToView = (view: HrDashboardView, ticketId?: string | null) => {
    const payload = { hrView: view, ticketId: ticketId ?? null };
    window.history.pushState(
      payload,
      "",
      window.location.pathname + window.location.search,
    );
    setActiveView(view);
    setSelectedTicketId(ticketId ?? null);
  };

  useEffect(() => {
    if (window.history.state?.hrView == null) {
      window.history.replaceState(
        { hrView: activeView, ticketId: selectedTicketId },
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const state = window.history.state as
        | { hrView?: HrDashboardView; ticketId?: string | null }
        | undefined;
      const view = state?.hrView ?? "dashboard";
      const id = state?.ticketId ?? null;
      setActiveView(view);
      setSelectedTicketId(id);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const renderContent = () => {
    switch (activeView) {
      case "dashboard":
        return (
          <HRDashboardView
            onViewRequisition={(reqId: number) => {
              goToView("ticket-detail", reqId.toString());
            }}
          />
        );
      case "employees":
        return <EmployeeList />;
      case "create-employee":
        return <CreateEmployee />;
      case "employee-profile":
        return <EmployeeProfile />;
      case "onboarding":
        return <OnboardingTracker />;

      case "bench-availability":
        return <BenchAvailability />;
      case "skills":
        return <SkillsOverview />;
      case "reports":
        return <HrReports />;
      case "audit-logs":
        return <HrAuditLog />;
      case "ticket":
        return (
          <HrRequisitions
            onViewRequisition={(ticketId: string) => {
              goToView("ticket-detail", ticketId);
            }}
          />
        );
      case "ticket-detail":
        return (
          <TicketDetails
            ticketId={selectedTicketId}
            onBack={() => window.history.back()}
          />
        );
      default:
        return (
          <>
            <h2 style={{ marginBottom: "12px" }}>{activeLabel}</h2>
            <p>HR view under construction.</p>
          </>
        );
    }
  };

  return (
    <div className={`admin-dashboard ${collapsed ? "sidebar-collapsed" : ""}`}>
      <HrSidebar
        activeView={activeView}
        onViewChange={(view) => goToView(view)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      <div
        className={`admin-main-content ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <Header />

        <HrHeader
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

export default HrDashboard;
