import React from "react";
import {
  LayoutDashboard,
  ClipboardList,
  FilePlus,
  FileText,
  Menu,
  X,
} from "lucide-react";

export type ManagerDashboardView =
  | "manager-dashboard"
  | "raise-requisition"
  | "my-requisitions"
  | "requisition-audit";

interface ManagerSidebarProps {
  activeView: ManagerDashboardView;
  onViewChange: (view: ManagerDashboardView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const ManagerSidebar: React.FC<ManagerSidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    id: ManagerDashboardView;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "manager-dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      id: "raise-requisition",
      label: "Raise Requisition",
      icon: <FilePlus size={20} />,
    },
    {
      id: "my-requisitions",
      label: "My Requisitions",
      icon: <ClipboardList size={20} />,
    },
    // {
    //   id: "requisition-audit",
    //   label: "Requisition Audit",
    //   icon: <FileText size={20} />,
    // },
  ];

  return (
    <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <LayoutDashboard size={24} className="brand-icon" />
            <span className="brand-text">Manager</span>
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

export default ManagerSidebar;
