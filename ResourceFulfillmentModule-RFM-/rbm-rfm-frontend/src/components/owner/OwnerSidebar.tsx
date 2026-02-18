import React from "react";
import {
  LayoutDashboard,
  Activity,
  FileText,
  Users,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";

export type OwnerDashboardView =
  | "executive-dashboard"
  | "resource-utilization"
  | "requisition-overview"
  | "ta-hr-performance"
  | "audit-approvals";

interface OwnerSidebarProps {
  activeView: OwnerDashboardView;
  onViewChange: (view: OwnerDashboardView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const OwnerSidebar: React.FC<OwnerSidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    id: OwnerDashboardView;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "executive-dashboard",
      label: "Executive Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      id: "resource-utilization",
      label: "Resource Utilization",
      icon: <Activity size={20} />,
    },
    {
      id: "requisition-overview",
      label: "Requisition Overview",
      icon: <FileText size={20} />,
    },
    {
      id: "ta-hr-performance",
      label: "TA & HR Performance",
      icon: <Users size={20} />,
    },
    {
      id: "audit-approvals",
      label: "Audit & Approvals",
      icon: <ShieldCheck size={20} />,
    },
  ];

  return (
    <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <LayoutDashboard size={24} className="brand-icon" />
            <span className="brand-text">Owner</span>
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

export default OwnerSidebar;
