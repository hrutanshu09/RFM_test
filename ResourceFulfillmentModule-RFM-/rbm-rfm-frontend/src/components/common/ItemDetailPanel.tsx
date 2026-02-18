/**
 * ============================================================================
 * ItemDetailPanel — Requisition Item Detail Drawer
 * ============================================================================
 *
 * Slide-out panel showing full details for a requisition item.
 * Includes workflow transition buttons based on current status and user role.
 *
 * USAGE:
 *   <ItemDetailPanel
 *     item={selectedItem}
 *     isOpen={panelOpen}
 *     onClose={() => setPanelOpen(false)}
 *     onUpdate={(updated) => handleItemUpdate(updated)}
 *   />
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  X,
  User,
  Briefcase,
  GraduationCap,
  Clock,
  MapPin,
  FileText,
  UserPlus,
  Search,
  Users,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useAuth } from "../../contexts/useAuth";
import { RoleGuard, useRoleCheck } from "../common/RoleGuard";
import StatusBadge from "../common/StatusBadge";
import ActivityTimeline from "../common/ActivityTimeline";
import {
  getItemAllowedTransitions,
  assignTA,
  shortlistItem,
  startInterview,
  makeOffer,
  fulfillItem,
  cancelItem,
  TransitionInfo,
} from "../../api/workflowApi";
import {
  getItemStatusLabel,
  RequisitionItemStatus,
  ITEM_STATUS_LABELS,
} from "../../types/workflow";

// ============================================
// Types
// ============================================

export interface RequisitionItemData {
  item_id: number;
  req_id: number;
  role_position: string;
  skill_level?: string | null;
  experience_years?: number | null;
  education_requirement?: string | null;
  job_description: string;
  requirements?: string | null;
  item_status: string;
  assigned_ta?: number | null;
  assigned_employee_id?: number | null;
  assigned_employee_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ItemDetailPanelProps {
  /** The item to display. */
  item: RequisitionItemData | null;
  /** Whether the panel is open. */
  isOpen: boolean;
  /** Callback when panel should close. */
  onClose: () => void;
  /** Callback when item is updated via workflow action. */
  onUpdate?: (item: RequisitionItemData) => void;
  /** Available TAs for assignment (for HR). */
  availableTAs?: { user_id: number; username: string; full_name?: string }[];
}

// ============================================
// Helper Functions
// ============================================

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Get action name from target_status for display/handling
 */
function getActionFromStatus(targetStatus: string): string {
  const actionMap: Record<string, string> = {
    Sourcing: "start-sourcing",
    Shortlisted: "shortlist",
    Interviewing: "interview",
    Offer_Extended: "offer",
    Fulfilled: "fulfill",
    Cancelled: "cancel",
  };
  return actionMap[targetStatus] || targetStatus.toLowerCase();
}

/**
 * Get display label for a transition
 */
function getTransitionLabel(transition: TransitionInfo): string {
  const labelMap: Record<string, string> = {
    Sourcing: "Start Sourcing",
    Shortlisted: "Mark Shortlisted",
    Interviewing: "Start Interview",
    Offer_Extended: "Make Offer",
    Fulfilled: "Mark Fulfilled",
    Cancelled: "Cancel",
  };
  return (
    labelMap[transition.target_status] ||
    transition.description ||
    transition.target_status
  );
}

// ============================================
// Sub-Components
// ============================================

interface WorkflowButtonProps {
  transition: TransitionInfo;
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
}

const WorkflowButton: React.FC<WorkflowButtonProps> = ({
  transition,
  onClick,
  loading,
  disabled = false,
}) => {
  const action = getActionFromStatus(transition.target_status);
  const isPrimary =
    action === "fulfill" || action === "shortlist" || action === "interview";
  const isDanger = action === "cancel";

  return (
    <button
      className={`action-button ${isPrimary ? "primary" : ""}`}
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        backgroundColor: isDanger ? "rgba(239, 68, 68, 0.1)" : undefined,
        borderColor: isDanger ? "var(--error)" : undefined,
        color: isDanger ? "var(--error)" : undefined,
        opacity: loading || disabled ? 0.7 : 1,
      }}
    >
      {loading ? (
        <Loader2
          size={14}
          className="animate-spin"
          style={{ marginRight: "6px" }}
        />
      ) : null}
      {getTransitionLabel(transition)}
    </button>
  );
};

// ============================================
// Main Component
// ============================================

export const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({
  item,
  isOpen,
  onClose,
  onUpdate,
  availableTAs = [],
}) => {
  const { user } = useAuth();
  const { isTA, isHR, isAdmin, userId } = useRoleCheck();

  const [allowedTransitions, setAllowedTransitions] = useState<
    TransitionInfo[]
  >([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTA, setSelectedTA] = useState<number | "">("");
  const [employeeIdInput, setEmployeeIdInput] = useState("");

  // Fetch allowed transitions when item changes
  useEffect(() => {
    if (!item || !isOpen) {
      setAllowedTransitions([]);
      return;
    }

    const fetchTransitions = async () => {
      setLoadingTransitions(true);
      try {
        const response = await getItemAllowedTransitions(item.item_id);
        setAllowedTransitions(response.allowed_transitions || []);
      } catch (err) {
        console.error("Failed to fetch transitions:", err);
        setAllowedTransitions([]);
      } finally {
        setLoadingTransitions(false);
      }
    };

    fetchTransitions();
  }, [item?.item_id, item?.item_status, isOpen]);

  // Handle workflow action
  const handleAction = useCallback(
    async (action: string) => {
      if (!item) return;

      setActiveAction(action);
      setError(null);

      try {
        let response;

        switch (action) {
          case "assign-ta":
            if (!selectedTA) {
              setError("Please select a TA to assign");
              return;
            }
            response = await assignTA(item.item_id, Number(selectedTA));
            setShowAssignModal(false);
            setSelectedTA("");
            break;

          case "self-assign":
            if (!userId) {
              setError("User not authenticated");
              return;
            }
            response = await assignTA(item.item_id, userId);
            break;

          case "shortlist":
            response = await shortlistItem(item.item_id);
            break;

          case "interview":
            response = await startInterview(item.item_id);
            break;

          case "offer":
            response = await makeOffer(item.item_id);
            break;

          case "fulfill":
            if (!employeeIdInput) {
              setError("Please provide an employee ID");
              return;
            }
            response = await fulfillItem(item.item_id, employeeIdInput);
            setEmployeeIdInput("");
            break;

          case "cancel":
            response = await cancelItem(item.item_id, "Cancelled by user");
            break;

          default:
            setError(`Unknown action: ${action}`);
            return;
        }

        // Notify parent to refresh
        if (onUpdate && response) {
          onUpdate({
            ...item,
            item_status: response.new_status || item.item_status,
            assigned_ta: action.includes("assign")
              ? Number(selectedTA) || userId
              : item.assigned_ta,
          } as RequisitionItemData);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Action failed";
        const apiMessage =
          typeof err === "object" &&
          err !== null &&
          "response" in err &&
          (err as { response?: { data?: { detail?: string } } }).response?.data
            ?.detail
            ? (err as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail
            : null;
        setError(apiMessage ?? message);
      } finally {
        setActiveAction(null);
      }
    },
    [item, selectedTA, userId, onUpdate, employeeIdInput],
  );

  // Don't render if closed or no item
  if (!isOpen || !item) return null;

  const itemStatus = item.item_status;
  const isAssigned = item.assigned_ta != null;
  const isAssignedToMe = item.assigned_ta === userId;
  const canSelfAssign = isTA() && !isAssigned && itemStatus === "Pending";

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          zIndex: 100,
          transition: "opacity 0.2s ease",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "500px",
          maxWidth: "100vw",
          backgroundColor: "var(--bg-primary)",
          boxShadow: "var(--shadow-xl)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.2s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3
              style={{ fontSize: "16px", fontWeight: 600, marginBottom: "4px" }}
            >
              {item.role_position}
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                Item #{item.item_id}
              </span>
              <StatusBadge
                status={item.item_status}
                entityType="item"
                size="sm"
              />
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              borderRadius: "8px",
              color: "var(--text-tertiary)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {/* Error */}
          {error && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.08)",
                color: "var(--error)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertCircle size={14} />
              {error}
              <button
                onClick={() => setError(null)}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Details Grid */}
          <div style={{ marginBottom: "24px" }}>
            <h4
              style={{
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "12px",
                color: "var(--text-secondary)",
              }}
            >
              Position Details
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Briefcase size={10} />
                  Skill Level
                </div>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  {item.skill_level || "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Clock size={10} />
                  Experience
                </div>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  {item.experience_years != null
                    ? `${item.experience_years} years`
                    : "—"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <GraduationCap size={10} />
                  Education
                </div>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  {item.education_requirement || "Any"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <User size={10} />
                  Assigned TA
                </div>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  {item.assigned_ta
                    ? `User #${item.assigned_ta}`
                    : "Unassigned"}
                </div>
              </div>
            </div>
          </div>

          {/* Requirements */}
          {item.requirements && (
            <div style={{ marginBottom: "24px" }}>
              <h4
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--text-secondary)",
                }}
              >
                Requirements
              </h4>
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              >
                {item.requirements}
              </div>
            </div>
          )}

          {/* Job Description */}
          {item.job_description && (
            <div style={{ marginBottom: "24px" }}>
              <h4
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--text-secondary)",
                }}
              >
                Job Description
              </h4>
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {item.job_description}
              </div>
            </div>
          )}

          {/* Assigned Employee */}
          {item.assigned_employee_name && (
            <div style={{ marginBottom: "24px" }}>
              <h4
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--text-secondary)",
                }}
              >
                Assigned Resource
              </h4>
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "rgba(16, 185, 129, 0.08)",
                  borderRadius: "8px",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    backgroundColor: "var(--success)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    fontSize: "14px",
                  }}
                >
                  {item.assigned_employee_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 500 }}>
                    {item.assigned_employee_name}
                  </div>
                  <div
                    style={{ fontSize: "12px", color: "var(--text-tertiary)" }}
                  >
                    Assigned to this position
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div style={{ marginBottom: "24px" }}>
            <h4
              style={{
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "12px",
                color: "var(--text-secondary)",
              }}
            >
              Activity
            </h4>
            <ActivityTimeline
              requisitionId={item.req_id}
              itemId={item.item_id}
              initialLimit={3}
              compact
            />
          </div>
        </div>

        {/* Footer - Actions */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-secondary)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: loadingTransitions ? "0" : undefined,
            }}
          >
            {loadingTransitions ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  color: "var(--text-tertiary)",
                  fontSize: "13px",
                }}
              >
                <Loader2 size={14} className="animate-spin" />
                Loading actions...
              </div>
            ) : (
              <>
                {/* Self-assign for TA */}
                {canSelfAssign && (
                  <button
                    className="action-button primary"
                    onClick={() => handleAction("self-assign")}
                    disabled={activeAction === "self-assign"}
                  >
                    {activeAction === "self-assign" ? (
                      <Loader2
                        size={14}
                        className="animate-spin"
                        style={{ marginRight: "6px" }}
                      />
                    ) : (
                      <UserPlus size={14} style={{ marginRight: "6px" }} />
                    )}
                    Self Assign
                  </button>
                )}

                {/* HR Assign */}
                <RoleGuard roles={["hr", "admin"]}>
                  {!isAssigned && itemStatus === "Pending" && (
                    <button
                      className="action-button"
                      onClick={() => setShowAssignModal(true)}
                    >
                      <UserPlus size={14} style={{ marginRight: "6px" }} />
                      Assign TA
                    </button>
                  )}
                </RoleGuard>

                {/* Dynamic workflow buttons */}
                {allowedTransitions.map((transition) => {
                  const action = getActionFromStatus(transition.target_status);
                  return (
                    <WorkflowButton
                      key={transition.target_status}
                      transition={transition}
                      onClick={() => handleAction(action)}
                      loading={activeAction === action}
                      disabled={activeAction !== null}
                    />
                  );
                })}

                {/* Cancel button for terminal states */}
                {!allowedTransitions.length &&
                  itemStatus !== "Fulfilled" &&
                  itemStatus !== "Cancelled" &&
                  (isAssignedToMe || isHR() || isAdmin()) && (
                    <button
                      className="action-button"
                      onClick={() => handleAction("cancel")}
                      disabled={activeAction === "cancel"}
                      style={{
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        borderColor: "var(--error)",
                        color: "var(--error)",
                      }}
                    >
                      {activeAction === "cancel" ? (
                        <Loader2
                          size={14}
                          className="animate-spin"
                          style={{ marginRight: "6px" }}
                        />
                      ) : (
                        <XCircle size={14} style={{ marginRight: "6px" }} />
                      )}
                      Cancel Item
                    </button>
                  )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Assign TA Modal */}
      {showAssignModal && (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 200,
            }}
            onClick={() => setShowAssignModal(false)}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              padding: "24px",
              width: "400px",
              maxWidth: "90vw",
              zIndex: 201,
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <h3
              style={{
                fontSize: "16px",
                fontWeight: 600,
                marginBottom: "16px",
              }}
            >
              Assign TA to Position
            </h3>
            <div className="form-field" style={{ marginBottom: "16px" }}>
              <label>Select Talent Acquisition Specialist</label>
              <select
                value={selectedTA}
                onChange={(e) =>
                  setSelectedTA(e.target.value ? Number(e.target.value) : "")
                }
                style={{ width: "100%" }}
              >
                <option value="">Choose a TA...</option>
                {availableTAs.map((ta) => (
                  <option key={ta.user_id} value={ta.user_id}>
                    {ta.full_name || ta.username}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="action-button"
                onClick={() => setShowAssignModal(false)}
              >
                Cancel
              </button>
              <button
                className="action-button primary"
                onClick={() => handleAction("assign-ta")}
                disabled={!selectedTA || activeAction === "assign-ta"}
              >
                {activeAction === "assign-ta" ? (
                  <Loader2
                    size={14}
                    className="animate-spin"
                    style={{ marginRight: "6px" }}
                  />
                ) : null}
                Assign
              </button>
            </div>
          </div>
        </>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
};

export default ItemDetailPanel;
