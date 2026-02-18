import React from "react";
import { Shield, Database, Users, FileText, Menu, X } from "lucide-react";
import { DashboardView } from "../../types/dashboard";

interface AdminSidebarProps {
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const AdminSidebar: React.FC<AdminSidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    id: DashboardView;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "overview", label: "Overview", icon: <Shield size={20} /> },
    { id: "master-data", label: "Master Data", icon: <Database size={20} /> },
    { id: "audit-logs", label: "Audit Logs", icon: <FileText size={20} /> },
    { id: "users", label: "User Management", icon: <Users size={20} /> },
  ];

  return (
    <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <Shield size={24} className="brand-icon" />
            <span className="brand-text">Admin Dashboard</span>
          </div>
        )}
        <button className="sidebar-toggle" onClick={onToggleCollapse}>
          {collapsed ? <Menu size={20} /> : <X size={20} color="white" />}
        </button>
      </div>

      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                className={`nav-item ${activeView === item.id ? "active" : ""}`}
                onClick={() => onViewChange(item.id)}
                title={collapsed ? item.label : ""}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {!collapsed && activeView === item.id && (
                  <span className="active-indicator"></span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default AdminSidebar;
