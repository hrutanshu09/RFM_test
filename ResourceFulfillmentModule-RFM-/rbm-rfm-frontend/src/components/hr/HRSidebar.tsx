import React from "react";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  UserCircle,
  ClipboardCheck,
  CalendarCheck,
  Award,
  BarChart3,
  FileText,
  Menu,
  X,
} from "lucide-react";

export type HrDashboardView =
  | "dashboard"
  | "employees"
  | "create-employee"
  | "employee-profile"
  | "onboarding"
  | "bench-availability"
  | "skills"
  | "reports"
  | "audit-logs"
  | "ticket"
  | "ticket-detail";

interface HrSidebarProps {
  activeView: HrDashboardView;
  onViewChange: (view: HrDashboardView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const HrSidebar: React.FC<HrSidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  const menuItems: {
    id: HrDashboardView;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    // { id: "employees", label: "Employees", icon: <Users size={20} /> },
    {
      id: "create-employee",
      label: "Create Employee",
      icon: <UserPlus size={20} />,
    },
    {
      id: "employee-profile",
      label: "Employee Profile",
      icon: <UserCircle size={20} />,
    },
    { id: "ticket", label: "Requisition", icon: <FileText size={20} /> },
    // {
    //   id: "onboarding",
    //   label: "Onboarding",
    //   icon: <ClipboardCheck size={20} />,
    // },
    // {
    //   id: "bench-availability",
    //   label: "Bench & Availability",
    //   icon: <CalendarCheck size={20} />,
    // },
    { id: "skills", label: "Skills", icon: <Award size={20} /> },
    // { id: "reports", label: "Reports", icon: <BarChart3 size={20} /> },
    // { id: "audit-logs", label: "Audit Logs", icon: <FileText size={20} /> },
  ];

  return (
    <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <LayoutDashboard size={24} className="brand-icon" />
            <span className="brand-text">HR Dashboard</span>
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

export default HrSidebar;
