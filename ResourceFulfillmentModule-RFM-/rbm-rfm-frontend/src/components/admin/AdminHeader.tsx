import React from "react";
import { Bell, Search, User } from "lucide-react";

interface AdminHeaderProps {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  onLogout: () => void;
  showUser?: boolean;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({
  title,
  user,
  onLogout,
  showUser = true,
}) => {
  const displayName = user?.username || user?.name || "Admin User";
  const displayRole = Array.isArray(user?.roles)
    ? user.roles.join(", ")
    : user?.role || "Administrator";

  return (
    <header className="admin-header">
      <div className="header-title">
        <h1>{title}</h1>
        <p>Manage and monitor your resource fulfillment system</p>
      </div>

      {showUser && (
        <div className="header-actions">
          {/* <div className="search-bar">
          <Search size={16} />
          <input type="text" placeholder="Search" />
        </div> */}

          <div className="header-user">
            {/* <button className="notification-btn" title="Notifications">
            <Bell size={18} />
            <span className="notification-badge">3</span>
          </button> */}

            <div className="user-info">
              <div className="user-name">{displayName}</div>
              <div className="user-role">{displayRole}</div>
            </div>

            <button
              className="user-avatar"
              onClick={onLogout}
              title="Logout"
              type="button"
            >
              {displayName ? (
                displayName.charAt(0).toUpperCase()
              ) : (
                <User size={18} />
              )}
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default AdminHeader;
