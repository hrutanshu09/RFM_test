import React from "react";
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  ClipboardCheck,
  Users,
  BarChart3,
  Menu,
  X,
} from "lucide-react";

export type TADashboardView =
  | "dashboard"
  | "requisitions"
  | "my-requisitions"
  | "requisition-detail"
  | "resource-pool"
  | "reports"
  | "audit-logs";

interface TASidebarProps {
  activeView: TADashboardView;
  onViewChange: (view: TADashboardView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const TASidebar: React.FC<TASidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    id: TADashboardView;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    { id: "requisitions", label: "Requisitions", icon: <FileText size={20} /> },
    {
      id: "my-requisitions",
      label: "My Requisitions",
      icon: <ClipboardList size={20} />,
    },
    {
      id: "resource-pool",
      label: "Resource Pool",
      icon: <Users size={20} />,
    },
    //{ id: "reports", label: "Reports", icon: <BarChart3 size={20} /> },
    // {
    //   id: "audit-logs",
    //   label: "Audit Logs",
    //   icon: <ClipboardCheck size={20} />,
    // },
  ];

  return (
    <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <LayoutDashboard size={24} className="brand-icon" />
            <span className="brand-text">TA Dashboard</span>
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

export default TASidebar;
