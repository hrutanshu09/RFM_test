/**
 * LoadingState — Centered spinner with optional message.
 */

import React from "react";
import { Loader2 } from "lucide-react";
import "./ui.css";

export interface LoadingStateProps {
  message?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Loading…",
  className = "",
}) => {
  return (
    <div className={`ui-loading-state ${className}`}>
      <Loader2 size={28} className="ui-loading-state__spinner" />
      <p className="ui-loading-state__message">{message}</p>
    </div>
  );
};

export default LoadingState;
