import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  Users,
  Briefcase,
  Search,
  Menu,
  X,
} from "lucide-react";

interface TASidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const TASidebar: React.FC<TASidebarProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    to: string;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      to: "/ta",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    { to: "/ta/requisitions", label: "Requisitions", icon: <FileText size={20} /> },
    {
      to: "/ta/my-requisitions",
      label: "My Requisitions",
      icon: <ClipboardList size={20} />,
    },
    {
      to: "/ta/resource-pool",
      label: "Resource Pool",
      icon: <Users size={20} />,
    },
    {
      to: "/ta/resume-screening",
      label: "Resume Screening",
      icon: <Search size={20} />,
    },
    {
      to: "/ta/projects",
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
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/ta"}
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

export default TASidebar;


