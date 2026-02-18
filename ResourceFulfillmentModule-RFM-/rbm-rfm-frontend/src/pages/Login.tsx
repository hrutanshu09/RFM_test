import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import "../styles/Login.css";
import RbmLogo from "../assets/rbm-logo.svg";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const loggedInUser = await login(username, password);

      const fromState = (location.state as { from?: { pathname?: string } })
        ?.from?.pathname;

      const defaultRedirect = loggedInUser.roles.some(
        (r) => r === "admin" || r === "owner",
      )
        ? "/admin"
        : "/dashboard";

      const target =
        fromState && fromState !== "/login" ? fromState : defaultRedirect;
      navigate(target, { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Invalid credentials. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card single">
        {/* LOGO */}
        <div className="login-logo">
          <img src={RbmLogo} alt="RBM Logo" />
        </div>

        <h2 className="form-title">Sign in</h2>
        <p className="form-subtitle">Enter your credentials to continue</p>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={isLoading}
              required
            />
          </div>

          <div className="form-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={isLoading}
              required
            />
          </div>

          <button type="submit" className="login-submit" disabled={isLoading}>
            {isLoading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* <div className="login-footer">
          <span>Need access?</span>
          <a href="#">Request credentials</a>
        </div> */}
      </div>
    </div>
  );
};

export default Login;
