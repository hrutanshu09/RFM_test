import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  FilePlus,
  Briefcase,
  Menu,
  X,
} from "lucide-react";

interface ManagerSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const ManagerSidebar: React.FC<ManagerSidebarProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    to: string;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      to: "/manager",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      to: "/manager/raise-requisition",
      label: "Raise Requisition",
      icon: <FilePlus size={20} />,
    },
    {
      to: "/manager/my-requisitions",
      label: "My Requisitions",
      icon: <ClipboardList size={20} />,
    },
    {
      to: "/manager/projects",
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
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/manager"}
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

export default ManagerSidebar;
