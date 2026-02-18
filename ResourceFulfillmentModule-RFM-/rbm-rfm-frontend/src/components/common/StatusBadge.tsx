/**
 * ============================================================================
 * StatusBadge — Centralized Status Rendering
 * ============================================================================
 *
 * SINGLE component for all status badge rendering across the app.
 * Derives class names from the canonical workflow types.
 * Accepts requisition OR item statuses.
 *
 * REPLACES:
 *  - Inline badge JSX in HrTickets, ManagerRequisitionDetails, etc.
 *  - WorkflowStatusBadge in WorkflowTransitionButtons.tsx
 *  - Scattered getStatusClass / switch statements
 */

import React from "react";
import {
  normalizeStatus,
  getStatusLabel,
  getStatusClass,
  getItemStatusLabel,
  getItemStatusClass,
} from "../../types/workflow";
import "./StatusBadge.css";

export type BadgeSize = "sm" | "md" | "lg";
export type BadgeEntityType = "requisition" | "item";

export interface StatusBadgeProps {
  /** Raw status string (may be legacy). */
  status: string;
  /** Whether this is a requisition or item status. */
  entityType?: BadgeEntityType;
  /** Visual size. */
  size?: BadgeSize;
  /** Additional CSS class. */
  className?: string;
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "status-badge--sm",
  md: "status-badge--md",
  lg: "status-badge--lg",
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  entityType = "requisition",
  size = "md",
  className = "",
}) => {
  const label =
    entityType === "item" ? getItemStatusLabel(status) : getStatusLabel(status);
  const statusClass =
    entityType === "item" ? getItemStatusClass(status) : getStatusClass(status);
  const sizeClass = SIZE_CLASSES[size];

  return (
    <span className={`status-badge ${statusClass} ${sizeClass} ${className}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
