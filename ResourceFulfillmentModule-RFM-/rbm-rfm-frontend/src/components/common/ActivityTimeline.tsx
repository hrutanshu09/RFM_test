/**
 * ============================================================================
 * ActivityTimeline — Master Activity Timeline Component
 * ============================================================================
 *
 * Unified timeline showing all status transitions, assignments, and audit events
 * for a requisition and its items. Uses the audit API.
 *
 * USAGE:
 *   <ActivityTimeline requisitionId={123} />
 *   <ActivityTimeline requisitionId={123} itemId={456} />
 */

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  User,
  ArrowRight,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
  UserPlus,
  Send,
} from "lucide-react";
import { apiClient } from "../../api/client";
import {
  getStatusLabel,
  getItemStatusLabel,
  normalizeStatus,
} from "../../types/workflow";

// ============================================
// Types
// ============================================

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "status_change" | "assignment" | "action" | "comment" | "system";
  title: string;
  description?: string;
  actor?: string;
  actorId?: number;
  oldValue?: string;
  newValue?: string;
  entityType: "requisition" | "item";
  entityId: number;
  metadata?: Record<string, unknown>;
}

interface AuditLogEntry {
  audit_id: number;
  entity_name: string;
  entity_id?: string | null;
  action: string;
  performed_by?: number | null;
  performed_by_username?: string | null;
  performed_by_full_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  performed_at: string;
}

interface StatusHistoryEntry {
  history_id: number;
  req_id: number;
  old_status?: string | null;
  new_status?: string | null;
  changed_by?: number | null;
  changed_at: string;
}

export interface ActivityTimelineProps {
  /** Requisition ID to show timeline for. */
  requisitionId: number;
  /** Optional item ID to filter timeline to specific item. */
  itemId?: number;
  /** Maximum number of events to show initially. */
  initialLimit?: number;
  /** Show expand/collapse controls. */
  collapsible?: boolean;
  /** Compact mode for embedding in cards. */
  compact?: boolean;
  /** Custom CSS class. */
  className?: string;
}

// ============================================
// Helper Functions
// ============================================

function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "—";
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function getEventIcon(event: TimelineEvent): React.ReactNode {
  const iconProps = { size: 16 };

  switch (event.type) {
    case "status_change":
      if (event.newValue?.toLowerCase().includes("reject")) {
        return <XCircle {...iconProps} color="var(--error)" />;
      }
      if (
        event.newValue?.toLowerCase().includes("fulfilled") ||
        event.newValue?.toLowerCase().includes("approved")
      ) {
        return <CheckCircle {...iconProps} color="var(--success)" />;
      }
      return <ArrowRight {...iconProps} color="var(--primary-accent)" />;

    case "assignment":
      return <UserPlus {...iconProps} color="var(--info)" />;

    case "action":
      if (event.title.toLowerCase().includes("submit")) {
        return <Send {...iconProps} color="var(--primary-accent)" />;
      }
      return <FileText {...iconProps} color="var(--text-secondary)" />;

    case "comment":
      return <FileText {...iconProps} color="var(--text-tertiary)" />;

    default:
      return <Clock {...iconProps} color="var(--text-tertiary)" />;
  }
}

function getEventColor(event: TimelineEvent): string {
  switch (event.type) {
    case "status_change":
      if (event.newValue?.toLowerCase().includes("reject"))
        return "var(--error)";
      if (event.newValue?.toLowerCase().includes("fulfilled"))
        return "var(--success)";
      if (event.newValue?.toLowerCase().includes("active"))
        return "var(--primary-accent)";
      return "var(--warning)";
    case "assignment":
      return "var(--info)";
    case "action":
      return "var(--primary-accent)";
    default:
      return "var(--text-tertiary)";
  }
}

function parseAuditToEvent(
  audit: AuditLogEntry,
  entityType: "requisition" | "item",
): TimelineEvent {
  const action = audit.action.toUpperCase();
  let type: TimelineEvent["type"] = "action";
  let title = audit.action;
  let description = "";

  if (
    action.includes("STATUS") ||
    action.includes("APPROVE") ||
    action.includes("REJECT")
  ) {
    type = "status_change";
    title = "Status changed";
    if (audit.old_value && audit.new_value) {
      const oldLabel =
        entityType === "item"
          ? getItemStatusLabel(audit.old_value)
          : getStatusLabel(audit.old_value);
      const newLabel =
        entityType === "item"
          ? getItemStatusLabel(audit.new_value)
          : getStatusLabel(audit.new_value);
      description = `${oldLabel} → ${newLabel}`;
    }
  } else if (action.includes("ASSIGN")) {
    type = "assignment";
    title = "Assignment changed";
    description = audit.new_value || "";
  } else if (action === "CREATE") {
    title = `${entityType === "requisition" ? "Requisition" : "Item"} created`;
  } else if (action === "UPDATE") {
    title = `${entityType === "requisition" ? "Requisition" : "Item"} updated`;
  }

  return {
    id: `audit-${audit.audit_id}`,
    timestamp: audit.performed_at,
    type,
    title,
    description,
    actor:
      audit.performed_by_full_name || audit.performed_by_username || undefined,
    actorId: audit.performed_by ?? undefined,
    oldValue: audit.old_value ?? undefined,
    newValue: audit.new_value ?? undefined,
    entityType,
    entityId: Number(audit.entity_id) || 0,
  };
}

function parseStatusHistoryToEvent(entry: StatusHistoryEntry): TimelineEvent {
  const oldLabel = entry.old_status ? getStatusLabel(entry.old_status) : "—";
  const newLabel = entry.new_status ? getStatusLabel(entry.new_status) : "—";

  return {
    id: `history-${entry.history_id}`,
    timestamp: entry.changed_at,
    type: "status_change",
    title: "Status changed",
    description: `${oldLabel} → ${newLabel}`,
    oldValue: entry.old_status ?? undefined,
    newValue: entry.new_status ?? undefined,
    entityType: "requisition",
    entityId: entry.req_id,
    actorId: entry.changed_by ?? undefined,
  };
}

// ============================================
// Component
// ============================================

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  requisitionId,
  itemId,
  initialLimit = 5,
  collapsible = true,
  compact = false,
  className = "",
}) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const allEvents: TimelineEvent[] = [];

      // Fetch requisition audit logs
      const auditResponse = await apiClient.get<AuditLogEntry[]>(
        `/audit/requisitions/${requisitionId}`,
      );
      auditResponse.data.forEach((audit) => {
        allEvents.push(parseAuditToEvent(audit, "requisition"));
      });

      // Fetch status history
      try {
        const historyResponse = await apiClient.get<StatusHistoryEntry[]>(
          `/requisitions/${requisitionId}/status-history`,
        );
        historyResponse.data.forEach((entry) => {
          allEvents.push(parseStatusHistoryToEvent(entry));
        });
      } catch {
        // Status history endpoint may not exist, ignore
      }

      // If item ID specified, fetch item-specific audit
      if (itemId) {
        try {
          const itemAuditResponse = await apiClient.get<AuditLogEntry[]>(
            `/audit/requisition-items/${itemId}`,
          );
          itemAuditResponse.data.forEach((audit) => {
            allEvents.push(parseAuditToEvent(audit, "item"));
          });
        } catch {
          // Item audit may not exist, ignore
        }
      }

      // Sort by timestamp descending (newest first)
      allEvents.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      // Deduplicate by ID
      const uniqueEvents = allEvents.filter(
        (event, index, self) =>
          index === self.findIndex((e) => e.id === event.id),
      );

      setEvents(uniqueEvents);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load timeline";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [requisitionId, itemId]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const displayedEvents = useMemo(() => {
    if (expanded || !collapsible) return events;
    return events.slice(0, initialLimit);
  }, [events, expanded, collapsible, initialLimit]);

  const hasMore = events.length > initialLimit;

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <div
        className={`activity-timeline ${className}`}
        style={{ padding: compact ? "12px" : "16px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--text-tertiary)",
          }}
        >
          <RefreshCw size={14} className="animate-spin" />
          <span style={{ fontSize: "13px" }}>Loading timeline...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`activity-timeline ${className}`}
        style={{ padding: compact ? "12px" : "16px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--error)",
          }}
        >
          <AlertCircle size={14} />
          <span style={{ fontSize: "13px" }}>{error}</span>
          <button
            onClick={fetchTimeline}
            style={{
              marginLeft: "8px",
              fontSize: "12px",
              color: "var(--primary-accent)",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className={`activity-timeline ${className}`}
        style={{ padding: compact ? "12px" : "16px" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            color: "var(--text-tertiary)",
            padding: "20px 0",
          }}
        >
          <Clock size={24} />
          <span style={{ fontSize: "13px" }}>No activity recorded yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`activity-timeline ${className}`}>
      {/* Header */}
      {!compact && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h4
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Clock size={16} />
            Activity Timeline
          </h4>
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Timeline */}
      <div style={{ position: "relative" }}>
        {displayedEvents.map((event, index) => (
          <div
            key={event.id}
            style={{
              display: "flex",
              gap: compact ? "10px" : "14px",
              paddingBottom:
                index === displayedEvents.length - 1
                  ? 0
                  : compact
                    ? "12px"
                    : "16px",
              position: "relative",
            }}
          >
            {/* Connector Line */}
            {index < displayedEvents.length - 1 && (
              <div
                style={{
                  position: "absolute",
                  left: compact ? "8px" : "10px",
                  top: "24px",
                  bottom: 0,
                  width: "2px",
                  backgroundColor: "var(--border-subtle)",
                }}
              />
            )}

            {/* Icon */}
            <div
              style={{
                width: compact ? "18px" : "22px",
                height: compact ? "18px" : "22px",
                borderRadius: "50%",
                backgroundColor: "var(--bg-primary)",
                border: `2px solid ${getEventColor(event)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                zIndex: 1,
              }}
            >
              {getEventIcon(event)}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: compact ? "12px" : "13px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {event.title}
                  </div>
                  {event.description && (
                    <div
                      style={{
                        fontSize: compact ? "11px" : "12px",
                        color: "var(--text-secondary)",
                        marginTop: "2px",
                      }}
                    >
                      {event.description}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: compact ? "10px" : "11px",
                    color: "var(--text-tertiary)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {formatTimestamp(event.timestamp)}
                </div>
              </div>

              {/* Actor */}
              {event.actor && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    marginTop: "4px",
                    fontSize: compact ? "10px" : "11px",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <User size={10} />
                  {event.actor}
                </div>
              )}

              {/* Item badge */}
              {event.entityType === "item" && !itemId && (
                <div
                  style={{
                    display: "inline-block",
                    marginTop: "4px",
                    padding: "2px 6px",
                    fontSize: "10px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    color: "var(--primary-accent)",
                    borderRadius: "4px",
                  }}
                >
                  Item #{event.entityId}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Expand/Collapse */}
      {collapsible && hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: "100%",
            padding: "10px",
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            fontSize: "12px",
            color: "var(--primary-accent)",
            background: "rgba(59, 130, 246, 0.05)",
            border: "1px solid rgba(59, 130, 246, 0.1)",
            borderRadius: "8px",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {expanded ? (
            <>
              <ChevronUp size={14} />
              Show less
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              Show {events.length - initialLimit} more
            </>
          )}
        </button>
      )}
    </div>
  );
};

export default ActivityTimeline;
