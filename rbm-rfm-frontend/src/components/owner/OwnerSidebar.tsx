import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  FileText,
  Users,
  ShieldCheck,
  Briefcase,
  Menu,
  X,
} from "lucide-react";

interface OwnerSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const OwnerSidebar: React.FC<OwnerSidebarProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    to: string;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      to: "/owner",
      label: "Executive Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      to: "/owner/resource-utilization",
      label: "Resource Utilization",
      icon: <Activity size={20} />,
    },
    {
      to: "/owner/requisition-overview",
      label: "Requisition Overview",
      icon: <FileText size={20} />,
    },
    {
      to: "/owner/ta-hr-performance",
      label: "TA & HR Performance",
      icon: <Users size={20} />,
    },
    {
      to: "/owner/audit-approvals",
      label: "Audit & Approvals",
      icon: <ShieldCheck size={20} />,
    },
    {
      to: "/owner/projects",
      label: "Project Management",
      icon: <Briefcase size={20} />,
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
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/owner"}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
                title={collapsed ? item.label : ""}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {!collapsed && <span className="active-indicator"></span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default OwnerSidebar;
