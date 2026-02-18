/**
 * ============================================================================
 * ReassignTAModal — Phase 7: TA Continuity & Replacement
 * ============================================================================
 *
 * Reusable inline modal for TA reassignment.  Two modes:
 *
 *   mode="item"   — reassign a single item to a new TA
 *   mode="bulk"   — reassign ALL active items of an old TA to a new TA
 *
 * All data mutations happen server-side; this component only collects
 * user input, validates it, and calls the API.
 *
 * Props:
 *   mode           — "item" | "bulk"
 *   reqId          — requisition ID (needed for bulk)
 *   itemId         — item ID (needed for item mode)
 *   itemLabel      — display label for item mode (e.g. "Python Lead")
 *   currentTAId    — currently assigned TA (null = unassigned)
 *   taUsers        — list of TA users for the dropdown
 *   usersById      — userId → username map (for display)
 *   onSuccess      — called after successful reassignment (refetch data)
 *   onClose        — close the modal
 */

import React, { useState, useMemo } from "react";
import { ArrowRight, X, UserCog, AlertTriangle } from "lucide-react";
import {
  reassignItemTA,
  bulkReassignTA,
  getWorkflowErrorMessage,
} from "../../api/workflowApi";

// ============================================================================
// TYPES
// ============================================================================

interface TAUserOption {
  user_id: number;
  username: string;
}

interface ReassignTAModalProps {
  mode: "item" | "bulk";
  reqId: number;
  /** Required for mode="item" */
  itemId?: number;
  /** Display label for item mode */
  itemLabel?: string;
  /** Currently assigned TA (null = unassigned) */
  currentTAId: number | null;
  /** For bulk mode: the "old TA" dropdown value */
  oldTAId?: number | null;
  /** List of TA users for dropdown */
  taUsers: TAUserOption[];
  /** userId → username lookup */
  usersById: Record<number, string>;
  /** Count of active items for the old TA (bulk mode preview) */
  activeItemCount?: number;
  /** Callback on success */
  onSuccess: () => void;
  /** Close the modal */
  onClose: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_REASON_LENGTH = 5;

// ============================================================================
// COMPONENT
// ============================================================================

const ReassignTAModal: React.FC<ReassignTAModalProps> = ({
  mode,
  reqId,
  itemId,
  itemLabel,
  currentTAId,
  oldTAId,
  taUsers,
  usersById,
  activeItemCount,
  onSuccess,
  onClose,
}) => {
  // For bulk mode the "from" TA comes from the parent.
  // For item mode it's the item's current assigned TA.
  const effectiveOldTAId = mode === "bulk" ? (oldTAId ?? null) : currentTAId;

  const [selectedNewTA, setSelectedNewTA] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const isReasonValid = trimmedReason.length >= MIN_REASON_LENGTH;
  const isSameTA =
    selectedNewTA !== null && selectedNewTA === effectiveOldTAId;

  const canSubmit =
    selectedNewTA !== null && isReasonValid && !isSameTA && !submitting;

  const getTAName = (taId: number | null) => {
    if (taId === null) return "Unassigned";
    return usersById[taId] ?? taUsers.find((t) => t.user_id === taId)?.username ?? `User #${taId}`;
  };

  /** Exclude the old TA from the dropdown options */
  const availableTAs = useMemo(
    () =>
      taUsers.filter((ta) => ta.user_id !== effectiveOldTAId),
    [taUsers, effectiveOldTAId],
  );

  // ---- Submit ----
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "item" && itemId != null) {
        await reassignItemTA(itemId, selectedNewTA, trimmedReason);
      } else if (mode === "bulk" && effectiveOldTAId != null) {
        await bulkReassignTA(reqId, {
          old_ta_id: effectiveOldTAId,
          new_ta_id: selectedNewTA,
          reason: trimmedReason,
        });
      }
      
      // Phase 7: Small delay to ensure backend transaction is committed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Dispatch event BEFORE onSuccess to trigger list refreshes
      window.dispatchEvent(new CustomEvent("requisition-reassigned", {
        detail: { reqId, itemId, newTAId: selectedNewTA }
      }));
      
      // Refresh the detail view - wait for it to complete
      await onSuccess();
      
      onClose();
    } catch (err) {
      setError(getWorkflowErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "480px",
          width: "90%",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <UserCog size={20} color="var(--primary-accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
                {mode === "item"
                  ? currentTAId
                    ? "Change Assigned TA"
                    : "Assign TA"
                  : "Bulk Change TA"}
              </h3>
              {mode === "item" && itemLabel && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    margin: "2px 0 0",
                  }}
                >
                  {itemLabel}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={18} color="var(--text-tertiary)" />
          </button>
        </div>

        {/* Transfer Summary */}
        <div
          style={{
            padding: "14px",
            backgroundColor: "var(--bg-tertiary, #f8f9fa)",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: "10px",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  fontWeight: 500,
                  letterSpacing: "0.5px",
                }}
              >
                From
              </div>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>
                {getTAName(effectiveOldTAId)}
              </div>
            </div>
            <ArrowRight size={18} color="var(--text-tertiary)" />
            <div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  fontWeight: 500,
                  letterSpacing: "0.5px",
                }}
              >
                To
              </div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "13px",
                  color: selectedNewTA
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                }}
              >
                {selectedNewTA ? getTAName(selectedNewTA) : "Select..."}
              </div>
            </div>
          </div>
          {mode === "bulk" && activeItemCount != null && (
            <div
              style={{
                marginTop: "10px",
                paddingTop: "10px",
                borderTop: "1px solid var(--border-subtle, #e5e7eb)",
                textAlign: "center",
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              <strong>{activeItemCount}</strong> active item(s) will be
              transferred
            </div>
          )}
        </div>

        {/* Bulk mode warning */}
        {mode === "bulk" && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              padding: "10px 12px",
              backgroundColor: "rgba(245, 158, 11, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(245, 158, 11, 0.2)",
              marginBottom: "16px",
              fontSize: "12px",
              color: "var(--warning, #d97706)",
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              This is an atomic operation. All items will be transferred in a
              single transaction.
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              marginBottom: "14px",
              padding: "10px 12px",
              borderRadius: "8px",
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "var(--error, #dc2626)",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {/* New TA dropdown */}
        <div style={{ marginBottom: "14px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "6px",
            }}
          >
            New TA <span style={{ color: "var(--error, #dc2626)" }}>*</span>
          </label>
          <select
            value={selectedNewTA ?? ""}
            onChange={(e) =>
              setSelectedNewTA(e.target.value ? Number(e.target.value) : null)
            }
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1px solid ${
                isSameTA
                  ? "var(--error, #dc2626)"
                  : "var(--border-subtle, #d1d5db)"
              }`,
              fontSize: "13px",
              backgroundColor: "var(--bg-primary, #fff)",
            }}
          >
            <option value="">Select TA...</option>
            {availableTAs.map((ta) => (
              <option key={ta.user_id} value={ta.user_id}>
                {ta.username} (ID: {ta.user_id})
              </option>
            ))}
          </select>
          {isSameTA && (
            <p
              style={{
                fontSize: "11px",
                color: "var(--error, #dc2626)",
                marginTop: "4px",
              }}
            >
              New TA must be different from the current TA
            </p>
          )}
        </div>

        {/* Reason */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "6px",
            }}
          >
            Reason <span style={{ color: "var(--error, #dc2626)" }}>*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for reassignment (min 5 characters)..."
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1px solid var(--border-subtle, #d1d5db)`,
              fontSize: "13px",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <p
            style={{
              fontSize: "11px",
              color:
                trimmedReason.length >= MIN_REASON_LENGTH
                  ? "var(--success, #16a34a)"
                  : "var(--text-tertiary, #9ca3af)",
              marginTop: "4px",
            }}
          >
            {trimmedReason.length}/{MIN_REASON_LENGTH} characters minimum
          </p>
        </div>

        {/* Actions */}
        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            className="action-button"
            onClick={onClose}
            disabled={submitting}
            style={{ padding: "10px 18px", fontSize: "13px" }}
          >
            Cancel
          </button>
          <button
            className="action-button primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "10px 18px",
              fontSize: "13px",
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {submitting
              ? "Processing..."
              : mode === "item"
                ? currentTAId
                  ? "Reassign TA"
                  : "Assign TA"
                : "Confirm Bulk Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReassignTAModal;
