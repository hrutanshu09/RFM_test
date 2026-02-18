/**
 * ErrorState — Structured error display with optional retry.
 */

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import "./ui.css";

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** HTTP status code (drives display: 403 vs 409 vs generic). */
  statusCode?: number;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  message,
  statusCode,
  onRetry,
  className = "",
}) => {
  const effectiveTitle =
    title ??
    (statusCode === 403
      ? "Access Denied"
      : statusCode === 409
        ? "Conflict Detected"
        : "Something Went Wrong");

  return (
    <div className={`ui-error-state ${className}`}>
      <AlertCircle size={32} className="ui-error-state__icon" />
      <h3 className="ui-error-state__title">{effectiveTitle}</h3>
      <p className="ui-error-state__message">{message}</p>
      {onRetry && (
        <button
          className="ui-error-state__retry"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw size={14} />
          Try Again
        </button>
      )}
    </div>
  );
};

export default ErrorState;
