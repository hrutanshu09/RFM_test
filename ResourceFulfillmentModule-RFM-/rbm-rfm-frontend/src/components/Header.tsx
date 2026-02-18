import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import RbmLogo from "../assets/rbm-logo.svg";
import "../styles/Header.css";

const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const getInitials = (username: string) => {
    return username
      .split(" ")
      .map((name) => name[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="header">
      <div className="header-container">
        <div className="header-left">
          <div className="logo-container">
            <div className="logo-icon" aria-hidden="true">
              <img src={RbmLogo} alt="RBM" />
            </div>
            <div className="logo-text">
              <h1 className="header-title">RBM Software</h1>
              <span className="header-subtitle">
                Resource Management System
              </span>
            </div>
          </div>
        </div>
        <div className="header-right">
          {user && (
            <div className="user-section">
              {/* <div className="user-profile">
                <div className="avatar-container">
                  <div className="avatar">{getInitials(user.username)}</div>
                </div>
                <div className="user-details">
                  <span className="username">{user.username}</span>
                  <div className="role-badges">
                    {user.roles.map((role, index) => (
                      <span key={index} className="role-badge">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div> */}
              <div className="divider"></div>
              <button className="logout-button" onClick={handleLogout}>
                <svg
                  className="logout-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
