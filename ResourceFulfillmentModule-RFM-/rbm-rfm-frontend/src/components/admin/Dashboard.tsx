import React, { useEffect, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import AdminSidebar from "../../components/admin/AdminSidebar";
import Header from "../../components/Header";
import AdminHeader from "../../components/admin/AdminHeader";
import AdminMetrics from "../../components/admin/AdminMetrics";
import MasterDataManager from "../../components/admin/MasterDataManager";
import AuditLogViewer from "../../components/admin/AuditLogViewer";
import UserManager from "./UserManager";
import "../../styles/admin/Dashboard.css";
import type { DashboardView } from "../../types/dashboard.ts";

const getViewTitle = (view: DashboardView): string => {
  const titles: Record<DashboardView, string> = {
    overview: "System Overview",
    "master-data": "Master Data Management",
    "audit-logs": "Audit Log Review",
    users: "User Management",
  };

  return titles[view] ?? "Admin Dashboard";
};

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const goToView = (view: DashboardView) => {
    window.history.pushState(
      { adminView: view },
      "",
      window.location.pathname + window.location.search,
    );
    setActiveView(view);
  };

  useEffect(() => {
    if (window.history.state?.adminView == null) {
      window.history.replaceState(
        { adminView: activeView },
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const state = window.history.state as { adminView?: DashboardView } | undefined;
      setActiveView(state?.adminView ?? "overview");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const hasAdminAccess = user?.roles?.some((role) =>
    ["admin", "owner"].includes(role),
  );

  if (!hasAdminAccess) {
    return (
      <div className="unauthorized-access">
        <h2>Unauthorized Access</h2>
        <p>You don't have permission to access the admin dashboard.</p>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeView) {
      case "overview":
        return (
          <>
            <AdminMetrics />
          </>
        );
      case "master-data":
        return <MasterDataManager />;
      case "audit-logs":
        return <AuditLogViewer />;
      case "users":
        return <UserManager />;
    }
  };

  return (
    <div
      className={`admin-dashboard ${
        sidebarCollapsed ? "sidebar-collapsed" : ""
      }`}
    >
      <AdminSidebar
        activeView={activeView}
        onViewChange={goToView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      <div
        className={`admin-main-content ${
          sidebarCollapsed ? "sidebar-collapsed" : ""
        }`}
      >
        <Header />

        <AdminHeader
          title={getViewTitle(activeView)}
          user={user}
          onLogout={() => {}}
          showUser={false}
        />

        <div className="admin-content-area">{renderActiveView()}</div>
      </div>
    </div>
  );
};

export default AdminDashboard;
