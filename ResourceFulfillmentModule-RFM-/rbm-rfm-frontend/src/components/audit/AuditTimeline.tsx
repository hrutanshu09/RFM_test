/**
 * ============================================================================
 * AUDIT TIMELINE COMPONENT
 * ============================================================================
 *
 * Enterprise-grade, read-only audit trail visualization.
 * Displays workflow transition history from the backend.
 *
 * Features:
 * - Vertical timeline layout (most recent on top)
 * - Colored status badges
 * - Action-type icons
 * - Loading skeleton state
 * - Empty state message
 * - Error state handling
 * - Mobile responsive
 *
 * This component is READ-ONLY and renders exactly what the backend provides.
 */

import React, { useMemo } from "react";
import {
  CheckCircle,
  XCircle,
  StopCircle,
  RefreshCw,
  Send,
  PlusCircle,
  UserCheck,
  Edit3,
  Circle,
  AlertCircle,
  Clock,
  FileText,
  Phone,
  Gift,
  DollarSign,
  UserCog,
} from "lucide-react";
import {
  AuditRecord,
  AuditActionType,
  classifyAction,
  formatAuditTimestamp,
  formatRelativeAuditTime,
  getActionClass,
  getStatusBadgeClass,
} from "../../api/auditApi";
import "./AuditTimeline.css";

// ============================================================================
// TYPES
// ============================================================================

export interface AuditTimelineProps {
  /** Audit records to display (should be pre-sorted DESC by created_at) */
  records: AuditRecord[];
  /** Loading state */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Whether to use compact mode (for embedded views) */
  compact?: boolean;
  /** Maximum height for scroll container (compact mode) */
  maxHeight?: number | string;
  /** Optional title override */
  title?: string;
  /** Show relative timestamps instead of absolute */
  relativeTime?: boolean;
  /** Entity type label for empty state */
  entityLabel?: string;
}

// ============================================================================
// ICON MAPPING
// ============================================================================

/**
 * Phase 6: Icon mapping for all timeline event types
 */
const ACTION_ICONS: Record<AuditActionType, React.ReactNode> = {
  approve: <CheckCircle size={16} />,
  reject: <XCircle size={16} />,
  cancel: <StopCircle size={16} />,
  reopen: <RefreshCw size={16} />,
  submit: <Send size={16} />,
  create: <PlusCircle size={16} />,
  fulfill: <CheckCircle size={16} />,
  assign: <UserCheck size={16} />,
  reassign: <UserCog size={16} />,
  update: <Edit3 size={16} />,
  shortlist: <FileText size={16} />,
  interview: <Phone size={16} />,
  offer: <Gift size={16} />,
  budget: <DollarSign size={16} />,
  unknown: <Circle size={16} />,
};

/**
 * Get icon for an action type.
 */
function getActionIcon(action: string): React.ReactNode {
  const actionType = classifyAction(action);
  return ACTION_ICONS[actionType];
}

// ============================================================================
// SKELETON COMPONENT
// ============================================================================

const TimelineSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="audit-timeline audit-timeline--loading">
    {Array.from({ length: count }).map((_, idx) => (
      <div
        key={idx}
        className="audit-timeline__item audit-timeline__item--skeleton"
      >
        <div className="audit-timeline__track">
          <div className="audit-timeline__node audit-timeline__node--skeleton" />
          {idx < count - 1 && <div className="audit-timeline__line" />}
        </div>
        <div className="audit-timeline__content">
          <div className="audit-timeline__skeleton-title" />
          <div className="audit-timeline__skeleton-meta" />
          <div className="audit-timeline__skeleton-badges" />
        </div>
      </div>
    ))}
  </div>
);

// ============================================================================
// EMPTY STATE COMPONENT
// ============================================================================

interface EmptyStateProps {
  entityLabel?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  entityLabel = "this record",
}) => (
  <div className="audit-timeline__empty">
    <Clock size={32} className="audit-timeline__empty-icon" />
    <p className="audit-timeline__empty-text">
      No audit history found for {entityLabel}.
    </p>
    <p className="audit-timeline__empty-hint">
      Transitions will appear here as they occur.
    </p>
  </div>
);

// ============================================================================
// ERROR STATE COMPONENT
// ============================================================================

interface ErrorStateProps {
  message: string;
}

const ErrorState: React.FC<ErrorStateProps> = ({ message }) => (
  <div className="audit-timeline__error">
    <AlertCircle size={32} className="audit-timeline__error-icon" />
    <p className="audit-timeline__error-text">{message}</p>
  </div>
);

// ============================================================================
// TIMELINE ITEM COMPONENT
// ============================================================================

interface TimelineItemProps {
  record: AuditRecord;
  isLast: boolean;
  relativeTime?: boolean;
}

const TimelineItem: React.FC<TimelineItemProps> = React.memo(
  ({ record, isLast, relativeTime = false }) => {
    const actionType = classifyAction(record.action);
    const actionClass = getActionClass(record.action);
    const icon = getActionIcon(record.action);

    const timestamp = relativeTime
      ? formatRelativeAuditTime(record.created_at)
      : formatAuditTimestamp(record.created_at);

    return (
      <div className={`audit-timeline__item ${actionClass}`}>
        <div className="audit-timeline__track">
          <div
            className={`audit-timeline__node audit-timeline__node--${actionType}`}
          >
            {icon}
          </div>
          {!isLast && <div className="audit-timeline__line" />}
        </div>

        <div className="audit-timeline__content">
          {/* Action header */}
          <div className="audit-timeline__header">
            <span className="audit-timeline__action">{record.action}</span>
            <span
              className="audit-timeline__timestamp"
              title={formatAuditTimestamp(record.created_at)}
            >
              {timestamp}
            </span>
          </div>

          {/* Status transition badges */}
          <div className="audit-timeline__transition">
            {record.from_status ? (
              <>
                <span
                  className={`audit-timeline__badge ${getStatusBadgeClass(
                    record.from_status,
                  )}`}
                >
                  {record.from_status.replace(/_/g, " ")}
                </span>
                <span className="audit-timeline__arrow">→</span>
              </>
            ) : null}
            <span
              className={`audit-timeline__badge ${getStatusBadgeClass(
                record.to_status,
              )}`}
            >
              {record.to_status.replace(/_/g, " ")}
            </span>
          </div>

          {/* Performer info */}
          <div className="audit-timeline__performer">
            <span className="audit-timeline__user">
              {record.performed_by.username}
            </span>
            <span className="audit-timeline__role">
              ({record.performed_by.role})
            </span>
          </div>

          {/* Reason (if present) */}
          {record.reason && (
            <div className="audit-timeline__reason">
              <span className="audit-timeline__reason-label">Reason:</span>
              <span className="audit-timeline__reason-text">
                {record.reason}
              </span>
            </div>
          )}

          {/* Version metadata */}
          <div className="audit-timeline__meta">
            <span className="audit-timeline__version">v{record.version}</span>
          </div>
        </div>
      </div>
    );
  },
);

TimelineItem.displayName = "TimelineItem";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AuditTimeline: React.FC<AuditTimelineProps> = ({
  records,
  isLoading = false,
  error = null,
  compact = false,
  maxHeight,
  title = "Audit History",
  relativeTime = false,
  entityLabel,
}) => {
  // Memoize timeline items to prevent unnecessary re-renders
  const timelineItems = useMemo(() => {
    return records.map((record, index) => (
      <TimelineItem
        key={record.id}
        record={record}
        isLast={index === records.length - 1}
        relativeTime={relativeTime}
      />
    ));
  }, [records, relativeTime]);

  const containerStyle: React.CSSProperties =
    compact && maxHeight
      ? {
          maxHeight:
            typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          overflowY: "auto",
        }
      : {};

  const containerClasses = [
    "audit-timeline-container",
    compact && "audit-timeline-container--compact",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {!compact && (
        <div className="audit-timeline-header">
          <h3 className="audit-timeline-title">{title}</h3>
          {!isLoading && !error && records.length > 0 && (
            <span className="audit-timeline-count">
              {records.length} event{records.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <div className="audit-timeline-body" style={containerStyle}>
        {isLoading && <TimelineSkeleton count={compact ? 2 : 3} />}

        {!isLoading && error && <ErrorState message={error} />}

        {!isLoading && !error && records.length === 0 && (
          <EmptyState entityLabel={entityLabel} />
        )}

        {!isLoading && !error && records.length > 0 && (
          <div className="audit-timeline">{timelineItems}</div>
        )}
      </div>
    </div>
  );
};

export default AuditTimeline;
