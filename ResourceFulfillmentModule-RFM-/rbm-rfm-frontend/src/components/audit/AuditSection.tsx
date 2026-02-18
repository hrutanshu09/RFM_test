/**
 * ============================================================================
 * AUDIT SECTION - Collapsible Wrapper with Lazy Loading
 * ============================================================================
 *
 * Provides a collapsible section that lazy-loads audit data on expand.
 * Uses memoization to prevent refetch loops.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { History, ChevronDown } from "lucide-react";
import { AuditTimeline } from "./AuditTimeline";
import {
  AuditRecord,
  AuditError,
  getRequisitionAudit,
  getItemAudit,
} from "../../api/auditApi";
import "./AuditTimeline.css";

// ============================================================================
// TYPES
// ============================================================================

export interface AuditSectionProps {
  /** Entity type for fetching audit data */
  entityType: "requisition" | "requisition-item";
  /** Entity ID */
  entityId: number;
  /** Optional title override */
  title?: string;
  /** Start expanded */
  defaultExpanded?: boolean;
  /** Show relative timestamps */
  relativeTime?: boolean;
  /** Compact mode for embedded views */
  compact?: boolean;
  /** Max height for compact mode */
  maxHeight?: number | string;
  /** Callback when audit data is loaded */
  onLoad?: (records: AuditRecord[]) => void;
  /** Callback on error */
  onError?: (error: AuditError) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const AuditSection: React.FC<AuditSectionProps> = ({
  entityType,
  entityId,
  title = "Audit History",
  defaultExpanded = false,
  relativeTime = false,
  compact = false,
  maxHeight = 400,
  onLoad,
  onError,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if we've already fetched for this entity
  const fetchedRef = useRef<string | null>(null);
  const cacheKey = `${entityType}-${entityId}`;

  /**
   * Fetch audit data (memoized to prevent refetch loops).
   */
  const fetchAuditData = useCallback(async () => {
    // Skip if already fetched for this entity
    if (fetchedRef.current === cacheKey) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let data: AuditRecord[];

      if (entityType === "requisition") {
        data = await getRequisitionAudit(entityId);
      } else {
        data = await getItemAudit(entityId);
      }

      setRecords(data);
      fetchedRef.current = cacheKey;
      onLoad?.(data);
    } catch (err) {
      const auditError = err as AuditError;
      setError(auditError.message ?? "Failed to load audit history");
      onError?.(auditError);
    } finally {
      setIsLoading(false);
    }
  }, [entityType, entityId, cacheKey, onLoad, onError]);

  /**
   * Handle expand/collapse toggle.
   * Lazy loads audit data on first expand.
   */
  const handleToggle = useCallback(() => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);

    // Fetch on first expand
    if (willExpand && fetchedRef.current !== cacheKey) {
      fetchAuditData();
    }
  }, [isExpanded, cacheKey, fetchAuditData]);

  /**
   * Reset fetch cache when entity changes.
   */
  useEffect(() => {
    if (fetchedRef.current && fetchedRef.current !== cacheKey) {
      // Entity changed, reset state
      setRecords([]);
      setError(null);
      fetchedRef.current = null;

      // If expanded, fetch new data
      if (isExpanded) {
        fetchAuditData();
      }
    }
  }, [cacheKey, isExpanded, fetchAuditData]);

  /**
   * Fetch on mount if defaultExpanded.
   */
  useEffect(() => {
    if (defaultExpanded && fetchedRef.current !== cacheKey) {
      fetchAuditData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityLabel =
    entityType === "requisition" ? "this requisition" : "this item";

  return (
    <div className="audit-section">
      <button
        type="button"
        className="audit-section__header"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <div className="audit-section__header-left">
          <History size={18} className="audit-section__icon" />
          <h3 className="audit-section__title">{title}</h3>
          {!isExpanded && records.length > 0 && (
            <span className="audit-timeline-count">
              {records.length} event{records.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={`audit-section__chevron ${
            isExpanded ? "audit-section__chevron--expanded" : ""
          }`}
        />
      </button>

      <div
        className={`audit-section__body ${
          !isExpanded ? "audit-section__body--collapsed" : ""
        }`}
      >
        <AuditTimeline
          records={records}
          isLoading={isLoading}
          error={error}
          compact={compact}
          maxHeight={maxHeight}
          relativeTime={relativeTime}
          entityLabel={entityLabel}
        />
      </div>
    </div>
  );
};

export default AuditSection;
