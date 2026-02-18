/**
 * WorkflowHeaderBlock — Status + Version + Timestamp + Transition buttons.
 *
 * Purely backend-driven. No local logic.
 */

import React from "react";
import { StatusBadge, type BadgeEntityType } from "../common/StatusBadge";
import {
  WorkflowTransitionButtons,
  type TransitionButtonConfig,
} from "../workflow/WorkflowTransitionButtons";
import type { WorkflowState } from "../../api/workflowHooks";
import "./ui.css";

export interface WorkflowHeaderBlockProps {
  /** Current status string. */
  status: string;
  /** "requisition" | "item" */
  entityType?: BadgeEntityType;
  /** Workflow state from hook. */
  workflowState: WorkflowState;
  /** Transition button configs. */
  buttonConfigs: TransitionButtonConfig[];
  /** Transition handler. */
  onTransition: (targetStatus: string, reason?: string) => Promise<void>;
  /** Optimistic lock version. */
  version?: number;
  /** Last updated ISO timestamp. */
  lastUpdated?: string;
  className?: string;
}

export const WorkflowHeaderBlock: React.FC<WorkflowHeaderBlockProps> = ({
  status,
  entityType = "requisition",
  workflowState,
  buttonConfigs,
  onTransition,
  version,
  lastUpdated,
  className = "",
}) => {
  const formattedDate = lastUpdated
    ? new Date(lastUpdated).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <div className={`workflow-header-block ${className}`}>
      <div className="workflow-header-block__info">
        <StatusBadge status={status} entityType={entityType} size="lg" />
        {version !== undefined && (
          <span className="workflow-header-block__version">v{version}</span>
        )}
        {formattedDate && (
          <span className="workflow-header-block__timestamp">
            Updated {formattedDate}
          </span>
        )}
      </div>
      <div className="workflow-header-block__actions">
        <WorkflowTransitionButtons
          workflowState={workflowState}
          buttonConfigs={buttonConfigs}
          onTransition={onTransition}
          size="md"
        />
      </div>
    </div>
  );
};

export default WorkflowHeaderBlock;
