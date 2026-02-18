/**
 * EmptyState — Shown when a list or section has no data.
 */

import React from "react";
import { Inbox } from "lucide-react";
import "./ui.css";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = "No data found",
  message,
  action,
  className = "",
}) => {
  return (
    <div className={`ui-empty-state ${className}`}>
      <div className="ui-empty-state__icon">{icon ?? <Inbox size={40} />}</div>
      <h3 className="ui-empty-state__title">{title}</h3>
      {message && <p className="ui-empty-state__message">{message}</p>}
      {action && <div className="ui-empty-state__action">{action}</div>}
    </div>
  );
};

export default EmptyState;
