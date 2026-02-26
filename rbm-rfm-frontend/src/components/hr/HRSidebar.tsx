import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  UserPlus,
  UserCircle,
  Award,
  FileText,
  Briefcase,
  Menu,
  X,
} from "lucide-react";

interface HrSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const HrSidebar: React.FC<HrSidebarProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    to: string;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      to: "/hr",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      to: "/hr/create-employee",
      label: "Create Employee",
      icon: <UserPlus size={20} />,
    },
    {
      to: "/hr/employee-profile",
      label: "Employee Profile",
      icon: <UserCircle size={20} />,
    },
    { to: "/hr/projects", label: "Project Management", icon: <Briefcase size={20} /> },
    { to: "/hr/requisitions", label: "Requisition", icon: <FileText size={20} /> },
    { to: "/hr/skills", label: "Skills", icon: <Award size={20} /> },
  ];

  return (
    <aside
      className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}
      aria-label="HR dashboard navigation"
    >
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <LayoutDashboard size={24} className="brand-icon" />
            <span className="brand-text">HR Dashboard</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <Menu size={20} /> : <X size={20} color="white" />}
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main menu">
        <ul role="list">
          {menuItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/hr"}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="nav-label">{item.label}</span>
                )}
                {!collapsed && <span className="active-indicator" aria-hidden />}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default HrSidebar;
