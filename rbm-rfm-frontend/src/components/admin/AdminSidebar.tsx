import React from "react";
import { NavLink } from "react-router-dom";
import { Shield, Database, Users, FileText, Briefcase, Menu, X } from "lucide-react";

interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const AdminSidebar: React.FC<AdminSidebarProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    to: string;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { to: "/admin", label: "Overview", icon: <Shield size={20} /> },
    { to: "/admin/master-data", label: "Master Data", icon: <Database size={20} /> },
    { to: "/admin/audit-logs", label: "Audit Logs", icon: <FileText size={20} /> },
    { to: "/admin/users", label: "User Management", icon: <Users size={20} /> },
    { to: "/admin/projects", label: "Project Management", icon: <Briefcase size={20} /> },
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
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
                title={collapsed ? item.label : ""}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {!collapsed && (
                  <span className="active-indicator"></span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default AdminSidebar;
