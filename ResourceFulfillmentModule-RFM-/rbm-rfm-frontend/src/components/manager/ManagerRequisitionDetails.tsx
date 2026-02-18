import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Edit,
  Save,
  X,
  FileText,
  Calendar,
  Briefcase,
  DollarSign,
  Clock,
  AlertCircle,
  Download,
  CheckCircle,
  Lock,
  History,
  Users,
  Eye,
} from "lucide-react";
import { apiClient } from "../../api/client";
import type { Candidate } from "../../api/candidateApi";
import { fetchCandidates } from "../../api/candidateApi";
import CandidateDetailModal from "../shared/CandidateDetailModal";
import { useAuth } from "../../contexts/useAuth";

// Types
interface RequisitionItem {
  item_id: number;
  role_position: string;
  skill_level?: string | null;
  experience_years?: number | null;
  education_requirement?: string | null;
  job_description: string;
  jd_file_key?: string | null;
  requirements?: string | null;
  item_status: string;
  estimated_budget?: number | null;
  approved_budget?: number | null;
  currency?: string;
}

interface Requisition {
  req_id: number;
  project_name?: string | null;
  client_name?: string | null;
  office_location?: string | null;
  work_mode?: string | null;
  required_by_date?: string | null;
  priority?: string | null;
  justification?: string | null;
  budget_amount?: number | null;
  duration?: string | null;
  is_replacement?: boolean | null;
  manager_notes?: string | null;
  overall_status: string;
  raised_by: number;
  raised_by_name?: string | null;
  jd_file_key?: string | null;
  created_at: string;
  updated_at: string;
  items: RequisitionItem[];
  budget_approved_by?: number | null;
  budget_approved_at?: string | null;
  hr_approved_by?: number | null;
  hr_approved_at?: string | null;
  total_estimated_budget?: number | null;
  total_approved_budget?: number | null;
  budget_approval_status?: "none" | "pending" | "partial" | "approved" | null;
}

interface StatusHistoryEntry {
  history_id: number;
  req_id: number;
  old_status?: string | null;
  new_status: string;
  changed_by: number;
  changed_by_name?: string | null;
  changed_at: string;
  justification?: string | null;
  comments?: string | null;
}

interface WorkflowAuditRecord {
  id: number;
  entity_type: "requisition" | "requisition_item";
  entity_id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  performed_by?: number | null;
  performed_by_username?: string | null;
  performed_by_full_name?: string | null;
  reason?: string | null;
  transition_metadata?: string | null;
  created_at: string;
}

interface WorkflowAuditResponse {
  entries: Array<{
    audit_id: number;
    entity_type: "requisition" | "requisition_item";
    entity_id: number;
    action: string;
    from_status: string;
    to_status: string;
    performed_by?: number | null;
    performed_by_username?: string | null;
    performed_by_full_name?: string | null;
    reason?: string | null;
    transition_metadata?: string | null;
    created_at: string;
  }>;
}

interface GenericAuditLog {
  audit_id: number;
  entity_name: string;
  entity_id: string;
  action: string;
  performed_by_username?: string | null;
  performed_by_full_name?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  performed_at: string;
}

type TimelinePhase =
  | "Creation"
  | "Budget"
  | "Authorization"
  | "Assignment"
  | "Recruitment"
  | "Workflow";

interface MasterTimelineEvent {
  id: string;
  timestamp: string;
  phase: TimelinePhase;
  title: string;
  description: string;
  actor?: string | null;
  reason?: string | null;
}

interface ItemFormData {
  id: number | "new";
  role_position: string;
  skill_level: string;
  experience_years: number;
  education_requirement: string;
  job_description: string;
  requirements: string;
}

interface RequisitionFormData {
  project_name: string;
  client_name: string;
  office_location: string;
  work_mode: string;
  required_by_date: string;
  priority: string;
  justification: string;
  budget_amount: string;
  duration: string;
  is_replacement: boolean;
  manager_notes: string;
  items: ItemFormData[];
}

// Status helpers
const normalizeStatus = (status: string): string => {
  const statusMap: Record<string, string> = {
    draft: "Draft",
    pending: "Pending Budget Approval",
    budget_approved: "Budget Approved",
    hr_review: "HR Review",
    hr_approved: "HR Approved",
    fulfilled: "Fulfilled",
    rejected: "Rejected",
    cancelled: "Cancelled",
  };
  return statusMap[status.toLowerCase()] || status;
};

const getStatusLabel = (status: string): string => {
  return normalizeStatus(status);
};

const getStatusClass = (status: string): string => {
  const normalized = normalizeStatus(status).toLowerCase();
  if (normalized.includes("draft")) return "bg-slate-100 text-slate-700";
  if (normalized.includes("pending")) return "bg-amber-100 text-amber-700";
  if (normalized.includes("approved")) return "bg-green-100 text-green-700";
  if (normalized.includes("rejected")) return "bg-red-100 text-red-700";
  if (normalized.includes("cancelled")) return "bg-gray-100 text-gray-700";
  return "bg-blue-100 text-blue-700";
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const label = getStatusLabel(status);
  const className = getStatusClass(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
};

// Date formatting
const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatCurrency = (amount?: number | null) => {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getPhaseStyle = (
  phase: TimelinePhase,
): { bg: string; border: string; dot: string; text: string } => {
  switch (phase) {
    case "Creation":
      return {
        bg: "bg-indigo-50",
        border: "border-indigo-200",
        dot: "bg-indigo-500",
        text: "text-indigo-700",
      };
    case "Budget":
      return {
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
        text: "text-emerald-700",
      };
    case "Authorization":
      return {
        bg: "bg-blue-50",
        border: "border-blue-200",
        dot: "bg-blue-500",
        text: "text-blue-700",
      };
    case "Assignment":
      return {
        bg: "bg-violet-50",
        border: "border-violet-200",
        dot: "bg-violet-500",
        text: "text-violet-700",
      };
    case "Recruitment":
      return {
        bg: "bg-amber-50",
        border: "border-amber-200",
        dot: "bg-amber-500",
        text: "text-amber-700",
      };
    default:
      return {
        bg: "bg-slate-50",
        border: "border-slate-200",
        dot: "bg-slate-500",
        text: "text-slate-700",
      };
  }
};

const getInitials = (name: string): string => {
  if (!name || name.startsWith("User ")) return "U";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

interface MasterTimelineProps {
  events: MasterTimelineEvent[];
}

const MasterTimeline: React.FC<MasterTimelineProps> = ({ events }) => {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="relative">
      {events.map((event, index) => {
        const phaseStyle = getPhaseStyle(event.phase);
        const isLast = index === events.length - 1;

        return (
          <div key={event.id} className="relative flex gap-4 pb-6">
            {/* Timeline track */}
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full ${phaseStyle.dot} ring-4 ring-white z-10`}
              />
              {!isLast && <div className="w-0.5 flex-1 bg-gray-200 -mt-1" />}
            </div>

            {/* Event card */}
            <div
              className={`flex-1 ${phaseStyle.bg} ${phaseStyle.border} border rounded-lg p-4 -mt-1`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className={`font-semibold ${phaseStyle.text}`}>
                    {event.title}
                  </h4>
                  <p className="text-sm text-gray-600 mt-1">
                    {event.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-3">
                {event.actor && (
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full ${phaseStyle.dot} text-white text-xs font-medium flex items-center justify-center`}
                    >
                      {getInitials(event.actor)}
                    </div>
                    <span className="text-sm text-gray-700 font-medium">
                      {event.actor}
                    </span>
                  </div>
                )}
                <span className="text-xs text-gray-500 ml-auto">
                  {formatRelativeTime(event.timestamp)} ·{" "}
                  {formatDateTime(event.timestamp)}
                </span>
              </div>

              {event.reason && (
                <div className="mt-3 p-3 bg-white/60 rounded-md border border-gray-100">
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    Notes / Reason
                  </div>
                  <p className="text-sm text-gray-700">{event.reason}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Main component
const ManagerRequisitionDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // State
  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [masterTimeline, setMasterTimeline] = useState<MasterTimelineEvent[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<RequisitionFormData | null>(null);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [jdError, setJdError] = useState<string | null>(null);
  const [isUploadingJd, setIsUploadingJd] = useState(false);
  const [isRemovingJd, setIsRemovingJd] = useState(false);
  const [jdInputKey, setJdInputKey] = useState(0);
  const [showJdViewer, setShowJdViewer] = useState(false);
  const [jdItemId, setJdItemId] = useState<number | null>(null);
  const [jdBlobUrl, setJdBlobUrl] = useState<string | null>(null);
  const [loadingJd, setLoadingJd] = useState(false);
  const [jdUploadTargetItemId, setJdUploadTargetItemId] = useState<number | null>(null);

  // Candidate pipeline (read-only for Manager)
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    null,
  );
  const [candidateStageFilter, setCandidateStageFilter] =
    useState<string>("all");
  const [candidateItemFilter, setCandidateItemFilter] = useState<
    number | "all"
  >("all");

  // Tab state
  type ManagerTab = "overview" | "positions" | "candidates" | "timeline";
  const [activeTab, setActiveTab] = useState<ManagerTab>("overview");

  const managerTabs: {
    id: ManagerTab;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "overview", label: "Overview", icon: <FileText size={16} /> },
    {
      id: "positions",
      label: "Positions & Budget",
      icon: <Briefcase size={16} />,
    },
    { id: "candidates", label: "Candidates", icon: <Users size={16} /> },
    {
      id: "timeline",
      label: "Timeline & History",
      icon: <History size={16} />,
    },
  ];

  // Permission check - Backend is single source of truth
  // Only Draft status allows editing by the creator
  const canEdit = useMemo(() => {
    if (!requisition || !user) return false;

    // Check if user is the creator
    const isCreator = user.user_id === requisition.raised_by;
    if (!isCreator) return false;

    // Only Draft status allows editing (backend-aligned rule)
    const status = normalizeStatus(requisition.overall_status);
    return status === "Draft";
  }, [requisition, user]);

  /**
   * Map workflow engine action to timeline phase.
   * Actions match exactly what workflow_engine_v2.py logs.
   */
  const inferPhaseFromAction = useCallback((action: string): TimelinePhase => {
    // Exact action names from workflow_engine_v2.py
    const budgetActions = [
      "SUBMIT",
      "APPROVE_BUDGET",
      "ALL_BUDGETS_APPROVED",
      "ITEM_BUDGET_EDITED",
      "ITEM_BUDGET_APPROVED",
      "ITEM_BUDGET_REJECTED",
    ];
    const authorizationActions = ["APPROVE_HR"];
    const assignmentActions = [
      "TA_ASSIGN",
      "TA_ASSIGN_AUTO_SOURCING",
      "SWAP_TA",
    ];
    const recruitmentActions = [
      "SHORTLIST",
      "START_INTERVIEW",
      "MAKE_OFFER",
      "FULFILL",
      "OFFER_DECLINED",
      "RE_SOURCE",
      "RETURN_TO_SHORTLIST",
    ];
    const workflowActions = [
      "REJECT",
      "CANCEL",
      "REOPEN_FOR_REVISION",
      "AUTO_RECALCULATE",
    ];

    const upper = action.toUpperCase();

    if (budgetActions.includes(upper)) return "Budget";
    if (authorizationActions.includes(upper)) return "Authorization";
    if (assignmentActions.includes(upper)) return "Assignment";
    if (recruitmentActions.includes(upper)) return "Recruitment";
    if (workflowActions.includes(upper)) return "Workflow";

    // Fallback for status history events
    const normalized = action.toLowerCase();
    if (
      normalized.includes("pending_budget") ||
      normalized.includes("budget")
    ) {
      return "Budget";
    }
    if (normalized.includes("pending_hr") || normalized.includes("active")) {
      return "Authorization";
    }
    return "Workflow";
  }, []);

  /**
   * Map workflow engine action to a business-friendly title.
   * Actions match exactly what workflow_engine_v2.py logs.
   */
  const actionLabel = useCallback((action: string): string => {
    const labelMap: Record<string, string> = {
      // Header actions
      SUBMIT: "Requisition Submitted for Budget Approval",
      APPROVE_BUDGET: "Budget Approved (Header)",
      APPROVE_HR: "HR Authorization Granted",
      REJECT: "Requisition Rejected",
      CANCEL: "Requisition Cancelled",
      REOPEN_FOR_REVISION: "Reopened for Revision",
      AUTO_RECALCULATE: "Status Auto-Recalculated",
      ALL_BUDGETS_APPROVED: "All Item Budgets Cleared",

      // Item budget actions
      ITEM_BUDGET_EDITED: "Item Budget Edited",
      ITEM_BUDGET_APPROVED: "Item Budget Approved",
      ITEM_BUDGET_REJECTED: "Item Budget Rejected",

      // Assignment actions
      TA_ASSIGN: "TA Assigned",
      TA_ASSIGN_AUTO_SOURCING: "TA Assigned (Auto-Sourcing Started)",
      SWAP_TA: "TA Reassigned",

      // Recruitment actions
      SHORTLIST: "Candidates Shortlisted",
      START_INTERVIEW: "Interview Process Started",
      MAKE_OFFER: "Offer Extended",
      FULFILL: "Position Fulfilled",
      OFFER_DECLINED: "Offer Declined",
      RE_SOURCE: "Returned to Sourcing",
      RETURN_TO_SHORTLIST: "Returned to Shortlist",
    };

    const upper = action.toUpperCase();
    if (labelMap[upper]) {
      return labelMap[upper];
    }

    // Fallback: format as title case
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, []);

  /**
   * Build business-friendly description for workflow events.
   * Based on exact actions from workflow_engine_v2.py
   */
  const buildWorkflowDescription = useCallback(
    (
      action: string,
      entityType: "requisition" | "requisition_item",
      entityId: number,
      fromStatus: string | null,
      toStatus: string,
    ): string => {
      const upper = action.toUpperCase();
      const isItem = entityType === "requisition_item";
      const entityRef = isItem ? `Item #${entityId}` : "Requisition";

      // Business-friendly descriptions per action
      const descriptionMap: Record<string, string> = {
        // Header actions
        SUBMIT: "Requisition submitted for budget review.",
        APPROVE_BUDGET: "Header-level budget approved. Moved to HR review.",
        APPROVE_HR: "HR authorization granted. Requisition is now Active.",
        REJECT: `${entityRef} was rejected.`,
        CANCEL: `${entityRef} was cancelled.`,
        REOPEN_FOR_REVISION:
          "Requisition reopened for revision after rejection.",
        AUTO_RECALCULATE:
          "Status automatically recalculated based on item changes.",
        ALL_BUDGETS_APPROVED:
          "All item budgets have been approved. Requisition moved to HR review.",

        // Item budget actions
        ITEM_BUDGET_EDITED: `Budget for ${entityRef} was edited.`,
        ITEM_BUDGET_APPROVED: `Budget for ${entityRef} was approved.`,
        ITEM_BUDGET_REJECTED: `Budget for ${entityRef} was rejected. Revision required.`,

        // Assignment actions
        TA_ASSIGN: `Talent Acquisition assigned to ${entityRef}.`,
        TA_ASSIGN_AUTO_SOURCING: `TA assigned to ${entityRef}. Sourcing started automatically.`,
        SWAP_TA: `TA reassigned for ${entityRef}.`,

        // Recruitment actions
        SHORTLIST: `Candidates shortlisted for ${entityRef}.`,
        START_INTERVIEW: `Interview process started for ${entityRef}.`,
        MAKE_OFFER: `Offer extended for ${entityRef}.`,
        FULFILL: `${entityRef} fulfilled. Employee assigned.`,
        OFFER_DECLINED: `Offer declined for ${entityRef}. Returning to interview stage.`,
        RE_SOURCE: `${entityRef} returned to sourcing for more candidates.`,
        RETURN_TO_SHORTLIST: `${entityRef} returned to shortlist stage.`,
      };

      if (descriptionMap[upper]) {
        return descriptionMap[upper];
      }

      // Fallback: generic transition description
      if (fromStatus && toStatus && fromStatus !== toStatus) {
        return `${entityRef} moved from ${fromStatus} to ${toStatus}.`;
      }
      return `${entityRef}: ${actionLabel(action)}.`;
    },
    [actionLabel],
  );

  const buildMasterTimeline = useCallback(
    (
      reqData: Requisition,
      reqStatusHistory: StatusHistoryEntry[],
      reqWorkflowAudit: WorkflowAuditRecord[],
      itemWorkflowAudit: WorkflowAuditRecord[],
      reqAuditLogs: GenericAuditLog[],
      itemAuditLogs: GenericAuditLog[],
    ): MasterTimelineEvent[] => {
      const events: MasterTimelineEvent[] = [];
      const seenKeys = new Set<string>();

      // Helper to avoid duplicates
      const addEvent = (event: MasterTimelineEvent) => {
        const key = `${event.phase}-${event.timestamp}-${event.title}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push(event);
        }
      };

      // Phase 1: Creation - Requisition raised
      addEvent({
        id: `creation-${reqData.req_id}`,
        timestamp: reqData.created_at,
        phase: "Creation",
        title: "Requisition Raised",
        description: `Requisition REQ-${reqData.req_id} created${
          reqData.project_name ? ` for project "${reqData.project_name}"` : ""
        }${reqData.client_name ? ` (Client: ${reqData.client_name})` : ""}.`,
        actor: reqData.raised_by_name ?? `User ${reqData.raised_by}`,
      });

      // Helper to resolve actor name from workflow audit entry
      const resolveActor = (entry: WorkflowAuditRecord): string => {
        if (entry.performed_by_full_name) return entry.performed_by_full_name;
        if (entry.performed_by_username) return entry.performed_by_username;
        if (entry.performed_by) return `User #${entry.performed_by}`;
        return "System";
      };

      // Workflow audit events (requisition-level) - these are the source of truth
      reqWorkflowAudit.forEach((entry) => {
        addEvent({
          id: `wf-req-${entry.id}`,
          timestamp: entry.created_at,
          phase: inferPhaseFromAction(entry.action),
          title: actionLabel(entry.action),
          description: buildWorkflowDescription(
            entry.action,
            "requisition",
            entry.entity_id,
            entry.from_status,
            entry.to_status,
          ),
          actor: resolveActor(entry),
          reason: entry.reason ?? null,
        });
      });

      // Workflow audit events (item-level)
      itemWorkflowAudit.forEach((entry) => {
        addEvent({
          id: `wf-item-${entry.id}`,
          timestamp: entry.created_at,
          phase: inferPhaseFromAction(entry.action),
          title: actionLabel(entry.action),
          description: buildWorkflowDescription(
            entry.action,
            "requisition_item",
            entry.entity_id,
            entry.from_status,
            entry.to_status,
          ),
          actor: resolveActor(entry),
          reason: entry.reason ?? null,
        });
      });

      // Status history (fallback for older events or supplementary info)
      // Only include if workflow audit doesn't already cover this transition
      reqStatusHistory.forEach((entry) => {
        const transitionKey = `${entry.old_status ?? "null"}->${entry.new_status}`;
        const alreadyCovered = reqWorkflowAudit.some(
          (wf) =>
            wf.from_status === entry.old_status &&
            wf.to_status === entry.new_status &&
            Math.abs(
              new Date(wf.created_at).getTime() -
                new Date(entry.changed_at).getTime(),
            ) < 60000, // within 1 minute
        );

        if (!alreadyCovered) {
          addEvent({
            id: `status-${entry.history_id}`,
            timestamp: entry.changed_at,
            phase: inferPhaseFromAction(entry.new_status),
            title: `Status: ${actionLabel(entry.new_status)}`,
            description: entry.old_status
              ? `Requisition transitioned from ${entry.old_status} to ${entry.new_status}.`
              : `Requisition status set to ${entry.new_status}.`,
            actor: entry.changed_by_name ?? `User ${entry.changed_by}`,
            reason: entry.justification ?? entry.comments ?? null,
          });
        }
      });

      // Generic audit logs (supplementary - for non-workflow actions like field edits)
      [...reqAuditLogs, ...itemAuditLogs].forEach((log) => {
        // Skip if it looks like a workflow action we already covered
        const upper = log.action.toUpperCase();
        const isWorkflowAction = [
          "SUBMIT",
          "APPROVE_BUDGET",
          "APPROVE_HR",
          "REJECT",
          "CANCEL",
          "ITEM_BUDGET_EDITED",
          "ITEM_BUDGET_APPROVED",
          "ITEM_BUDGET_REJECTED",
          "TA_ASSIGN",
          "TA_ASSIGN_AUTO_SOURCING",
          "SHORTLIST",
          "START_INTERVIEW",
          "MAKE_OFFER",
          "FULFILL",
        ].includes(upper);

        if (!isWorkflowAction) {
          const entityRef =
            log.entity_name === "requisition_item"
              ? `Item #${log.entity_id}`
              : `Requisition #${log.entity_id}`;

          addEvent({
            id: `audit-${log.audit_id}`,
            timestamp: log.performed_at,
            phase: inferPhaseFromAction(log.action),
            title: actionLabel(log.action),
            description: `${entityRef}: ${actionLabel(log.action)}.`,
            actor:
              log.performed_by_full_name ??
              log.performed_by_username ??
              "System",
          });
        }
      });

      // Sort by timestamp descending (most recent first)
      return events.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    },
    [actionLabel, inferPhaseFromAction, buildWorkflowDescription],
  );

  // Fetch data
  useEffect(() => {
    if (!id) {
      setError("Invalid requisition ID");
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [
          requisitionRes,
          historyRes,
          reqWorkflowAuditRes,
          reqAuditLogsRes,
        ] = await Promise.all([
          apiClient.get<Requisition>(`/requisitions/${id}`),
          apiClient.get<StatusHistoryEntry[]>(
            `/requisitions/${id}/status-history`,
          ),
          apiClient
            .get<WorkflowAuditResponse>(`/workflow/audit/${id}`, {
              params: { include_items: true, page: 1, page_size: 200 },
            })
            .catch(() => ({ data: { entries: [] } })),
          apiClient
            .get<GenericAuditLog[]>(`/audit-logs/`, {
              params: { entity_name: "requisition", entity_id: id },
            })
            .catch(() => ({ data: [] })),
        ]);

        const reqData = requisitionRes.data;
        const workflowEntries = (reqWorkflowAuditRes.data.entries || []).map(
          (entry) => ({
            id: entry.audit_id,
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            from_status: entry.from_status,
            to_status: entry.to_status,
            action: entry.action,
            performed_by: entry.performed_by ?? null,
            performed_by_username: entry.performed_by_username ?? null,
            performed_by_full_name: entry.performed_by_full_name ?? null,
            reason: entry.reason ?? null,
            transition_metadata: entry.transition_metadata ?? null,
            created_at: entry.created_at,
          }),
        );
        const reqWorkflowAudit = workflowEntries.filter(
          (entry) => entry.entity_type === "requisition",
        );
        const itemWorkflowAudit = workflowEntries.filter(
          (entry) => entry.entity_type === "requisition_item",
        );

        const itemIds = reqData.items.map((item) => item.item_id);
        const itemAuditLogResponses = await Promise.all(
          itemIds.map((itemId) =>
            apiClient
              .get<GenericAuditLog[]>(`/audit-logs/`, {
                params: {
                  entity_name: "requisition_item",
                  entity_id: String(itemId),
                },
              })
              .catch(() => ({ data: [] })),
          ),
        );

        const itemAuditLogs = itemAuditLogResponses.flatMap(
          (response) => response.data ?? [],
        );

        // Normalize items: preserve jd_file_key and budget fields from API (estimated vs approved are distinct)
        const requisitionWithItems = {
          ...reqData,
          items: (reqData.items || []).map((it: RequisitionItem) => ({
            ...it,
            jd_file_key: it.jd_file_key ?? null,
            estimated_budget: it.estimated_budget != null ? Number(it.estimated_budget) : null,
            approved_budget: it.approved_budget != null ? Number(it.approved_budget) : null,
          })),
        };
        setRequisition(requisitionWithItems);
        setStatusHistory(historyRes.data || []);
        setMasterTimeline(
          buildMasterTimeline(
            reqData,
            historyRes.data || [],
            reqWorkflowAudit,
            itemWorkflowAudit,
            reqAuditLogsRes.data || [],
            itemAuditLogs,
          ),
        );
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        setError(
          axiosErr.response?.data?.detail ||
            "Failed to load requisition details",
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id, buildMasterTimeline]);

  // Load candidates for this requisition (read-only view)
  useEffect(() => {
    if (!requisition) return;

    let isMounted = true;
    const loadCandidates = async () => {
      try {
        setCandidatesLoading(true);
        setCandidateError(null);
        const data = await fetchCandidates(requisition.req_id);
        if (!isMounted) return;
        setCandidates(data);
      } catch (err: unknown) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load candidates";
        setCandidateError(message);
      } finally {
        if (isMounted) {
          setCandidatesLoading(false);
        }
      }
    };

    loadCandidates();

    return () => {
      isMounted = false;
    };
  }, [requisition?.req_id]);

  // Handle before unload for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue =
          "You have unsaved changes. Are you sure you want to leave?";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Initialize form data
  const initializeFormData = useCallback((data: Requisition) => {
    setFormData({
      project_name: data.project_name || "",
      client_name: data.client_name || "",
      office_location: data.office_location || "",
      work_mode: data.work_mode || "Hybrid",
      required_by_date: data.required_by_date || "",
      priority: data.priority || "Medium",
      justification: data.justification || "",
      budget_amount: data.budget_amount?.toString() || "",
      duration: data.duration || "",
      is_replacement: Boolean(data.is_replacement),
      manager_notes: data.manager_notes || "",
      items: data.items.map((item) => ({
        id: item.item_id,
        role_position: item.role_position,
        skill_level: item.skill_level || "Mid",
        experience_years: item.experience_years || 3,
        education_requirement: item.education_requirement || "",
        job_description: item.job_description,
        requirements: item.requirements || "",
      })),
    });
  }, []);

  // Enter edit mode
  const handleEditStart = () => {
    if (!requisition) return;
    initializeFormData(requisition);
    setIsEditing(true);
    setSaveMessage(null);
    setHasUnsavedChanges(false);
    setActiveTab("positions");
  };

  // Cancel edit
  const handleEditCancel = () => {
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "You have unsaved changes. Are you sure you want to cancel?",
      )
    ) {
      return;
    }
    setIsEditing(false);
    setFormData(null);
    setSaveMessage(null);
    setHasUnsavedChanges(false);
  };

  // Update form field
  const handleFieldChange = <K extends keyof RequisitionFormData>(
    field: K,
    value: RequisitionFormData[K],
  ) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
    setHasUnsavedChanges(true);
  };

  // Handle item updates
  const handleItemUpdate = (
    index: number,
    field: keyof ItemFormData,
    value: string | number,
  ) => {
    if (!formData) return;

    const updatedItems = [...formData.items];
    const current = updatedItems[index];
    if (!current) return;
    updatedItems[index] = { ...current, [field]: value };

    setFormData({ ...formData, items: updatedItems });
    setHasUnsavedChanges(true);
  };

  const handleAddItem = () => {
    if (!formData) return;

    const newItem: ItemFormData = {
      id: "new",
      role_position: "",
      skill_level: "Mid",
      experience_years: 3,
      education_requirement: "",
      job_description: "",
      requirements: "",
    };

    setFormData({ ...formData, items: [...formData.items, newItem] });
    setHasUnsavedChanges(true);
  };

  const handleRemoveItem = (index: number) => {
    if (!formData || formData.items.length <= 1) return;

    const updatedItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: updatedItems });
    setHasUnsavedChanges(true);
  };

  // Validate form
  const validateForm = (): string[] => {
    const errors: string[] = [];

    if (!formData) return ["Form data not initialized"];

    if (!formData.project_name.trim()) {
      errors.push("Project name is required");
    }

    if (!formData.required_by_date) {
      errors.push("Required by date is required");
    }

    if (formData.items.length === 0) {
      errors.push("At least one position is required");
    }

    formData.items.forEach((item, index) => {
      if (!item.role_position.trim()) {
        errors.push(`Position ${index + 1}: Role/Position is required`);
      }
      if (!item.job_description.trim()) {
        errors.push(`Position ${index + 1}: Job description is required`);
      }
    });

    return errors;
  };

  // Save changes
  const handleSave = async () => {
    if (!formData || !requisition) return;

    // Validate
    const errors = validateForm();
    if (errors.length > 0) {
      setSaveMessage({
        type: "error",
        message: `Please fix the following errors:\n${errors.join("\n")}`,
      });
      return;
    }

    try {
      setIsSaving(true);
      setSaveMessage(null);

      const payload = {
        project_name: formData.project_name,
        client_name: formData.client_name || null,
        office_location: formData.office_location,
        work_mode: formData.work_mode,
        required_by_date: formData.required_by_date,
        priority: formData.priority,
        justification: formData.justification,
        budget_amount: formData.budget_amount
          ? parseFloat(formData.budget_amount)
          : null,
        duration: formData.duration || null,
        is_replacement: formData.is_replacement,
        manager_notes: formData.manager_notes,
        items: formData.items.map((item) => ({
          role_position: item.role_position,
          job_description: item.job_description,
          skill_level: item.skill_level,
          experience_years: item.experience_years,
          education_requirement: item.education_requirement || null,
          requirements: item.requirements || null,
        })),
      };

      await apiClient.put(`/requisitions/${requisition.req_id}`, payload);

      // Refresh data (including master timeline sources)
      const [requisitionRes, historyRes, reqWorkflowAuditRes, reqAuditLogsRes] =
        await Promise.all([
          apiClient.get<Requisition>(`/requisitions/${id}`),
          apiClient.get<StatusHistoryEntry[]>(
            `/requisitions/${id}/status-history`,
          ),
          apiClient
            .get<WorkflowAuditResponse>(`/workflow/audit/${id}`, {
              params: { include_items: true, page: 1, page_size: 200 },
            })
            .catch(() => ({ data: { entries: [] } })),
          apiClient
            .get<GenericAuditLog[]>(`/audit-logs/`, {
              params: { entity_name: "requisition", entity_id: id },
            })
            .catch(() => ({ data: [] })),
        ]);

      const reqData = requisitionRes.data;
      const workflowEntries = (reqWorkflowAuditRes.data.entries || []).map(
        (entry) => ({
          id: entry.audit_id,
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          from_status: entry.from_status,
          to_status: entry.to_status,
          action: entry.action,
          performed_by: entry.performed_by ?? null,
          performed_by_username: entry.performed_by_username ?? null,
          performed_by_full_name: entry.performed_by_full_name ?? null,
          reason: entry.reason ?? null,
          transition_metadata: entry.transition_metadata ?? null,
          created_at: entry.created_at,
        }),
      );
      const reqWorkflowAudit = workflowEntries.filter(
        (entry) => entry.entity_type === "requisition",
      );
      const itemWorkflowAudit = workflowEntries.filter(
        (entry) => entry.entity_type === "requisition_item",
      );

      const itemIds = reqData.items.map((item) => item.item_id);
      const itemAuditLogResponses = await Promise.all(
        itemIds.map((itemId) =>
          apiClient
            .get<GenericAuditLog[]>(`/audit-logs/`, {
              params: {
                entity_name: "requisition_item",
                entity_id: String(itemId),
              },
            })
            .catch(() => ({ data: [] })),
        ),
      );

      const itemAuditLogs = itemAuditLogResponses.flatMap(
        (response) => response.data ?? [],
      );

      const requisitionWithItemsAfterSave = {
        ...reqData,
        items: (reqData.items || []).map((it: RequisitionItem) => ({
          ...it,
          jd_file_key: it.jd_file_key ?? null,
          estimated_budget: it.estimated_budget != null ? Number(it.estimated_budget) : null,
          approved_budget: it.approved_budget != null ? Number(it.approved_budget) : null,
        })),
      };
      setRequisition(requisitionWithItemsAfterSave);
      setStatusHistory(historyRes.data || []);
      setMasterTimeline(
        buildMasterTimeline(
          requisitionWithItemsAfterSave,
          historyRes.data || [],
          reqWorkflowAudit,
          itemWorkflowAudit,
          reqAuditLogsRes.data || [],
          itemAuditLogs,
        ),
      );

      setSaveMessage({
        type: "success",
        message: "Requisition updated successfully",
      });
      setIsEditing(false);
      setHasUnsavedChanges(false);

      // Clear success message after 5 seconds
      setTimeout(() => setSaveMessage(null), 5000);
    } catch (err: unknown) {
      setSaveMessage({
        type: "error",
        message: "Failed to update requisition",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Item-level JD: download
  const handleDownloadItemJD = async (itemId: number) => {
    try {
      const response = await apiClient.get<any>(
        `/requisitions/items/${itemId}/jd`,
        { responseType: "blob" },
      );
      const blob = new Blob([response.data as BlobPart], {
        type: "application/pdf",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const item = requisition?.items?.find((i) => i.item_id === itemId);
      link.setAttribute(
        "download",
        `JD_${item?.role_position ?? itemId}.pdf`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setSaveMessage({
        type: "error",
        message: "Failed to download job description",
      });
    }
  };

  const handleJdFileChange = (e: React.ChangeEvent<HTMLInputElement>, itemId: number) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setJdFile(null);
      setJdError(null);
      setJdUploadTargetItemId(null);
      return;
    }
    if (file.type !== "application/pdf") {
      setJdFile(null);
      setJdError("Only PDF files are allowed.");
      e.target.value = "";
      setJdUploadTargetItemId(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setJdFile(null);
      setJdError("File exceeds 10MB.");
      e.target.value = "";
      setJdUploadTargetItemId(null);
      return;
    }
    setJdFile(file);
    setJdError(null);
    setJdUploadTargetItemId(itemId);
  };

  const handleUploadItemJD = async (itemId: number) => {
    if (!requisition || !jdFile || jdUploadTargetItemId !== itemId) return;

    setIsUploadingJd(true);
    setJdError(null);

    try {
      const payload = new FormData();
      payload.append("jd_file", jdFile);

      const response = await apiClient.post<{ message?: string; jd_file_key?: string }>(
        `/requisitions/items/${itemId}/jd`,
        payload,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );

      const jdKey =
        (response.data && "jd_file_key" in response.data && response.data.jd_file_key) ||
        null;
      setRequisition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) =>
            it.item_id === itemId ? { ...it, jd_file_key: jdKey || it.jd_file_key } : it,
          ),
        };
      });
      setJdFile(null);
      setJdUploadTargetItemId(null);
      setJdInputKey((prev) => prev + 1);
      setSaveMessage({
        type: "success",
        message: "Job description uploaded for position",
      });
      setTimeout(() => setSaveMessage(null), 5000);
    } catch (err: unknown) {
      setSaveMessage({
        type: "error",
        message: "Failed to upload job description",
      });
    } finally {
      setIsUploadingJd(false);
    }
  };

  const handleRemoveItemJD = async (itemId: number) => {
    if (!requisition) return;

    setIsRemovingJd(true);
    setJdError(null);

    try {
      await apiClient.delete(`/requisitions/items/${itemId}/jd`);
      setRequisition((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.item_id === itemId ? { ...it, jd_file_key: null } : it,
              ),
            }
          : prev,
      );
      setJdFile(null);
      setJdUploadTargetItemId(null);
      setJdInputKey((prev) => prev + 1);
      setSaveMessage({
        type: "success",
        message: "Job description removed",
      });
      setTimeout(() => setSaveMessage(null), 5000);
    } catch (err: unknown) {
      setSaveMessage({
        type: "error",
        message: "Failed to remove job description",
      });
    } finally {
      setIsRemovingJd(false);
    }
  };

  // Load JD PDF for viewer when modal opens (item-level)
  useEffect(() => {
    if (!showJdViewer || !jdItemId) {
      if (jdBlobUrl) {
        URL.revokeObjectURL(jdBlobUrl);
        setJdBlobUrl(null);
      }
      return;
    }
    let objectUrl: string | null = null;
    const loadJd = async () => {
      setLoadingJd(true);
      try {
        const response = await apiClient.get<Blob>(
          `/requisitions/items/${jdItemId}/jd`,
          { responseType: "blob" },
        );
        objectUrl = URL.createObjectURL(response.data as Blob);
        setJdBlobUrl(objectUrl);
      } catch {
        setJdBlobUrl(null);
      } finally {
        setLoadingJd(false);
      }
    };
    void loadJd();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setJdBlobUrl(null);
    };
  }, [showJdViewer, jdItemId]);

  const closeJdViewer = () => {
    setShowJdViewer(false);
    setJdItemId(null);
    if (jdBlobUrl) {
      URL.revokeObjectURL(jdBlobUrl);
      setJdBlobUrl(null);
    }
  };

  const openJdViewerForItem = (itemId: number) => {
    setJdItemId(itemId);
    setShowJdViewer(true);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-600">Loading requisition details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !requisition) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Unable to Load Requisition
          </h3>
          <p className="text-gray-600 mb-6">
            {error || "Requisition not found"}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-200 rounded-t-xl -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate(-1)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-sm font-medium">Back</span>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    REQ-{requisition.req_id}
                  </h1>
                  <div className="flex items-center gap-3 mt-1">
                    <StatusBadge status={requisition.overall_status} />
                    <span className="text-sm text-gray-500">
                      Created: {formatDate(requisition.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {!isEditing ? (
                  <button
                    onClick={handleEditStart}
                    disabled={!canEdit}
                    title={
                      canEdit
                        ? "Edit requisition"
                        : "Editing is locked. HR has already acted on this requisition."
                    }
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                      canEdit
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {canEdit ? (
                      <Edit className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    <span>
                      {canEdit ? "Edit Requisition" : "Editing Locked"}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    {hasUnsavedChanges && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <AlertCircle className="h-3 w-3" />
                        <span className="text-xs font-medium">
                          Unsaved changes
                        </span>
                      </span>
                    )}
                    <button
                      onClick={handleEditCancel}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Save message */}
            {saveMessage && (
              <div
                className={`mt-4 p-4 rounded-lg border ${
                  saveMessage.type === "success"
                    ? "bg-green-50 border-green-200 text-green-800"
                    : "bg-red-50 border-red-200 text-red-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  {saveMessage.type === "success" ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {saveMessage.message}
                  </span>
                </div>
              </div>
            )}

            {/* Permission warning */}
            {!canEdit && !isEditing && (
              <div className="mt-4 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  <span className="text-sm">
                    <strong>Editing is locked.</strong> This requisition has
                    progressed beyond the point where manager edits are allowed.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {formatDate(requisition.required_by_date)}
                </div>
                <div className="text-xs text-gray-500">Required By</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {formatCurrency(
                    requisition.total_estimated_budget ??
                      requisition.budget_amount,
                  )}
                </div>
                <div className="text-xs text-gray-500">Total Estimated</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 text-green-600 rounded-lg">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {formatCurrency(requisition.total_approved_budget)}
                </div>
                <div className="text-xs text-gray-500">Total Approved</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {requisition.items.length}
                </div>
                <div className="text-xs text-gray-500">Positions</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 text-gray-600 rounded-lg">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {requisition.duration || "—"}
                </div>
                <div className="text-xs text-gray-500">Duration</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "24px",
            padding: "4px",
            backgroundColor: "#f3f4f6",
            borderRadius: "12px",
          }}
        >
          {managerTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === tab.id ? "#ffffff" : "transparent",
                color: activeTab === tab.id ? "#111827" : "#6b7280",
                boxShadow:
                  activeTab === tab.id ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: activeTab === tab.id ? 600 : 500,
                transition: "all 0.15s ease",
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === "positions" && hasUnsavedChanges && (
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "#f59e0b",
                    display: "inline-block",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Main Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Requisition Summary */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Requisition Summary
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Core requisition details and work arrangement
                  </p>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Project Name
                      </div>
                      <div className="text-gray-900 font-medium">
                        {requisition.project_name || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Client Name
                      </div>
                      <div className="text-gray-900">
                        {requisition.client_name || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Required By Date
                      </div>
                      <div className="text-gray-900">
                        {formatDate(requisition.required_by_date)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Priority
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          requisition.priority?.toLowerCase() === "high"
                            ? "bg-red-100 text-red-700"
                            : requisition.priority?.toLowerCase() === "critical"
                              ? "bg-purple-100 text-purple-700"
                              : requisition.priority?.toLowerCase() === "low"
                                ? "bg-gray-100 text-gray-700"
                                : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {requisition.priority || "Medium"}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Work Mode
                      </div>
                      <div className="text-gray-900">
                        {requisition.work_mode || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Office Location
                      </div>
                      <div className="text-gray-900">
                        {requisition.office_location || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Duration
                      </div>
                      <div className="text-gray-900">
                        {requisition.duration || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Replacement Position
                      </div>
                      <div className="text-gray-900">
                        {requisition.is_replacement ? "Yes" : "No"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Budget Summary (compact, read-only) */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Budget Summary
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Computed budget totals and business case
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-800 mb-4">
                      <DollarSign className="h-4 w-4" />
                      Budget Overview (Computed from Items)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          Total Estimated
                        </div>
                        <div className="font-semibold text-gray-900">
                          {formatCurrency(
                            requisition.total_estimated_budget ??
                              requisition.budget_amount,
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          Total Approved
                        </div>
                        <div className="font-semibold text-green-700">
                          {formatCurrency(requisition.total_approved_budget)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          Approval Status
                        </div>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            requisition.budget_approval_status === "approved"
                              ? "bg-green-100 text-green-700"
                              : requisition.budget_approval_status === "partial"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {requisition.budget_approval_status === "approved"
                            ? "All Items Approved"
                            : requisition.budget_approval_status === "partial"
                              ? "Partially Approved"
                              : "Pending Approval"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-3">
                      Justification
                    </div>
                    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                      {requisition.justification || "No justification provided"}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-3">
                      Manager Notes
                    </div>
                    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                      {requisition.manager_notes || "No additional notes"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* JD Preview */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Job Description
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Attached documents
                  </p>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600">
                    Job descriptions are attached per position. View or upload in the{" "}
                    <button
                      type="button"
                      onClick={() => setActiveTab("positions")}
                      className="text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Positions
                    </button>{" "}
                    tab.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ POSITIONS & BUDGET TAB ═══════════════ */}
        {activeTab === "positions" && (
          <div className="space-y-6">
            {/* Requisition Details (edit mode only) */}
            {isEditing && formData && (
              <>
                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Requisition Details
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Core details and work arrangement
                    </p>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Project Name *
                        </label>
                        <input
                          type="text"
                          value={formData.project_name}
                          onChange={(e) =>
                            handleFieldChange("project_name", e.target.value)
                          }
                          placeholder="Enter project name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Client Name
                        </label>
                        <input
                          type="text"
                          value={formData.client_name}
                          onChange={(e) =>
                            handleFieldChange("client_name", e.target.value)
                          }
                          placeholder="Enter client name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Required By Date *
                        </label>
                        <input
                          type="date"
                          value={formData.required_by_date}
                          onChange={(e) =>
                            handleFieldChange(
                              "required_by_date",
                              e.target.value,
                            )
                          }
                          min={new Date().toISOString().split("T")[0]}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Priority
                        </label>
                        <select
                          value={formData.priority}
                          onChange={(e) =>
                            handleFieldChange("priority", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Critical">Critical</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Work Mode
                        </label>
                        <select
                          value={formData.work_mode}
                          onChange={(e) =>
                            handleFieldChange("work_mode", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="Remote">Remote</option>
                          <option value="Hybrid">Hybrid</option>
                          <option value="On-site">On-site</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Office Location
                        </label>
                        <input
                          type="text"
                          value={formData.office_location}
                          onChange={(e) =>
                            handleFieldChange("office_location", e.target.value)
                          }
                          placeholder="Enter office location"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Duration
                        </label>
                        <input
                          type="text"
                          value={formData.duration}
                          onChange={(e) =>
                            handleFieldChange("duration", e.target.value)
                          }
                          placeholder="e.g., 6 months, 1 year"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Replacement Position
                        </label>
                        <select
                          value={formData.is_replacement ? "yes" : "no"}
                          onChange={(e) =>
                            handleFieldChange(
                              "is_replacement",
                              e.target.value === "yes",
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="no">No - New Position</option>
                          <option value="yes">Yes - Backfill</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Skills Required / Positions */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  Skills Required
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Position requirements and descriptions
                </p>
              </div>
              <div className="p-6">
                {!isEditing ? (
                  requisition.items.length === 0 ? (
                    <div className="text-center py-12">
                      <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No positions added</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {requisition.items.map((item, index) => (
                        <div
                          key={item.item_id}
                          className="border border-gray-200 rounded-lg p-4"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="font-semibold text-gray-900">
                                {item.role_position}
                              </h4>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                  {item.skill_level || "Not specified"}
                                </span>
                                <span className="text-sm text-gray-500">
                                  {item.experience_years || "—"} years
                                  experience
                                </span>
                                <span className="text-sm text-gray-500">
                                  {item.education_requirement || "—"}
                                </span>
                              </div>
                            </div>
                            <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-gray-600 text-sm font-medium">
                              {index + 1}
                            </span>
                          </div>

                          {/* Item Budget Section */}
                          <div className="bg-green-50 rounded-lg p-3 mb-4">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                              <DollarSign className="h-4 w-4" />
                              Budget
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                              <div>
                                <span className="text-gray-500">
                                  Estimated (manager):
                                </span>{" "}
                                <span className="font-medium text-gray-900">
                                  {item.estimated_budget != null
                                    ? `${item.currency || "INR"} ${Number(item.estimated_budget).toLocaleString()}`
                                    : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Approved (budget):</span>{" "}
                                <span
                                  className={`font-medium ${
                                    item.approved_budget != null
                                      ? "text-green-700"
                                      : "text-gray-500"
                                  }`}
                                >
                                  {item.approved_budget != null
                                    ? `${item.currency || "INR"} ${Number(item.approved_budget).toLocaleString()}`
                                    : "Pending"}
                                </span>
                              </div>
                              <div>
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                    item.approved_budget != null
                                      ? "bg-green-100 text-green-700"
                                      : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {item.approved_budget != null
                                    ? "Approved"
                                    : "Pending Approval"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mb-4">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                              Job Description
                            </div>
                            <p className="text-gray-700 text-sm leading-relaxed">
                              {item.job_description}
                            </p>
                          </div>

                          {item.requirements && (
                            <div>
                              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                                Additional Requirements
                              </div>
                              <p className="text-gray-700 text-sm leading-relaxed">
                                {item.requirements}
                              </p>
                            </div>
                          )}

                          {/* Item-level JD: always show row; View/Read when JD exists */}
                          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Job description (PDF)
                            </span>
                            {Boolean(item.jd_file_key) ? (
                                <>
                                  <button
                                    onClick={() => openJdViewerForItem(item.item_id)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    View / Read JD
                                  </button>
                                  <button
                                    onClick={() => handleDownloadItemJD(item.item_id)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                  </button>
                                  {canEdit && (
                                    <button
                                      onClick={() => handleRemoveItemJD(item.item_id)}
                                      disabled={isRemovingJd}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 disabled:opacity-50"
                                    >
                                      {isRemovingJd ? "Removing..." : "Remove"}
                                    </button>
                                  )}
                                </>
                              ) : canEdit ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    key={`jd-${item.item_id}-${jdInputKey}`}
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(e) => handleJdFileChange(e, item.item_id)}
                                    disabled={isUploadingJd || isRemovingJd}
                                    className="text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700"
                                  />
                                  <button
                                    onClick={() => handleUploadItemJD(item.item_id)}
                                    disabled={!jdFile || jdUploadTargetItemId !== item.item_id || isUploadingJd || isRemovingJd}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                  >
                                    {isUploadingJd ? "Uploading..." : "Upload JD"}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-sm">No JD attached</span>
                              )}
                              {jdError && jdUploadTargetItemId === item.item_id && (
                                <span className="text-sm text-red-600">{jdError}</span>
                              )}
                            </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  formData && (
                    <div className="space-y-4">
                      {formData.items.map((item, index) => (
                        <div
                          key={index}
                          className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-medium text-gray-900">
                              Position {index + 1}
                            </h4>
                            {formData.items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(index)}
                                className="text-sm text-red-600 hover:text-red-700 font-medium"
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Role / Position *
                              </label>
                              <input
                                type="text"
                                value={item.role_position}
                                onChange={(e) =>
                                  handleItemUpdate(
                                    index,
                                    "role_position",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., Senior Frontend Developer"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Skill Level
                              </label>
                              <select
                                value={item.skill_level}
                                onChange={(e) =>
                                  handleItemUpdate(
                                    index,
                                    "skill_level",
                                    e.target.value,
                                  )
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              >
                                <option value="Junior">Junior</option>
                                <option value="Mid">Mid</option>
                                <option value="Senior">Senior</option>
                                <option value="Lead">Lead</option>
                                <option value="Architect">Architect</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Experience (years)
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="50"
                                value={item.experience_years}
                                onChange={(e) =>
                                  handleItemUpdate(
                                    index,
                                    "experience_years",
                                    parseInt(e.target.value) || 0,
                                  )
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Education Requirement
                              </label>
                              <input
                                type="text"
                                value={item.education_requirement}
                                onChange={(e) =>
                                  handleItemUpdate(
                                    index,
                                    "education_requirement",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., B.Tech, MBA"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                          </div>

                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Job Description *
                            </label>
                            <textarea
                              rows={3}
                              value={item.job_description}
                              onChange={(e) =>
                                handleItemUpdate(
                                  index,
                                  "job_description",
                                  e.target.value,
                                )
                              }
                              placeholder="Describe the role responsibilities..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                          </div>

                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Additional Requirements
                            </label>
                            <textarea
                              rows={2}
                              value={item.requirements}
                              onChange={(e) =>
                                handleItemUpdate(
                                  index,
                                  "requirements",
                                  e.target.value,
                                )
                              }
                              placeholder="Any specific certifications, skills, or requirements..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                          </div>

                          {/* JD PDF: use requisition item when existing (id !== "new") */}
                          {item.id !== "new" && requisition && (() => {
                            const reqItem = requisition.items.find((i) => i.item_id === item.id);
                            const itemId = typeof item.id === "number" ? item.id : null;
                            if (itemId == null) return null;
                            return (
                              <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Job description (PDF)
                                </span>
                                {Boolean(reqItem?.jd_file_key) ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openJdViewerForItem(itemId)}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      View / Read JD
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadItemJD(itemId)}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      Download
                                    </button>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveItemJD(itemId)}
                                        disabled={isRemovingJd}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 disabled:opacity-50"
                                      >
                                        {isRemovingJd ? "Removing..." : "Remove"}
                                      </button>
                                    )}
                                  </>
                                ) : canEdit ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      key={`jd-edit-${itemId}-${jdInputKey}`}
                                      type="file"
                                      accept="application/pdf"
                                      onChange={(e) => handleJdFileChange(e, itemId)}
                                      disabled={isUploadingJd || isRemovingJd}
                                      className="text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleUploadItemJD(itemId)}
                                      disabled={!jdFile || jdUploadTargetItemId !== itemId || isUploadingJd || isRemovingJd}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                    >
                                      {isUploadingJd ? "Uploading..." : "Upload JD"}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 text-sm">No JD attached</span>
                                )}
                                {jdError && jdUploadTargetItemId === itemId && (
                                  <span className="text-sm text-red-600">{jdError}</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-700 rounded-lg font-medium transition-colors"
                      >
                        <Briefcase className="h-4 w-4" />
                        Add Another Position
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Budget & Justification */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  Budget Summary & Justification
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Computed budget totals and business case
                </p>
              </div>
              <div className="p-6">
                {!isEditing ? (
                  <div className="space-y-6">
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <div className="flex items-center gap-2 text-sm font-medium text-green-800 mb-4">
                        <DollarSign className="h-4 w-4" />
                        Budget Overview (Computed from Items)
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">
                            Total Estimated
                          </div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(
                              requisition.total_estimated_budget ??
                                requisition.budget_amount,
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">
                            Total Approved
                          </div>
                          <div className="font-semibold text-green-700">
                            {formatCurrency(requisition.total_approved_budget)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">
                            Approval Status
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              requisition.budget_approval_status === "approved"
                                ? "bg-green-100 text-green-700"
                                : requisition.budget_approval_status ===
                                    "partial"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {requisition.budget_approval_status === "approved"
                              ? "All Items Approved"
                              : requisition.budget_approval_status === "partial"
                                ? "Partially Approved"
                                : "Pending Approval"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-3">
                        Justification
                      </div>
                      <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                        {requisition.justification ||
                          "No justification provided"}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-3">
                        Manager Notes
                      </div>
                      <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                        {requisition.manager_notes || "No additional notes"}
                      </div>
                    </div>
                  </div>
                ) : (
                  formData && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Budget Amount
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                              ₹
                            </span>
                            <input
                              type="number"
                              min="0"
                              value={formData.budget_amount}
                              onChange={(e) =>
                                handleFieldChange(
                                  "budget_amount",
                                  e.target.value,
                                )
                              }
                              placeholder="Enter amount"
                              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Replacement Position
                          </label>
                          <select
                            value={formData.is_replacement ? "yes" : "no"}
                            onChange={(e) =>
                              handleFieldChange(
                                "is_replacement",
                                e.target.value === "yes",
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="no">No - New Position</option>
                            <option value="yes">Yes - Backfill</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Justification *
                        </label>
                        <textarea
                          rows={4}
                          value={formData.justification}
                          onChange={(e) =>
                            handleFieldChange("justification", e.target.value)
                          }
                          placeholder="Explain why this position is needed, business impact, etc."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Manager Notes
                        </label>
                        <textarea
                          rows={3}
                          value={formData.manager_notes}
                          onChange={(e) =>
                            handleFieldChange("manager_notes", e.target.value)
                          }
                          placeholder="Any additional notes or context..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ CANDIDATES TAB ═══════════════ */}
        {activeTab === "candidates" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  Candidate Pipeline
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Read-only view of candidates linked to this requisition and
                  their current stages.
                </p>
              </div>
              <div className="p-6 space-y-4">
                {candidateError && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    {candidateError}
                  </div>
                )}

                {candidatesLoading ? (
                  <div className="py-6 text-center text-gray-500 text-sm">
                    Loading candidates...
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="py-6 text-center text-gray-500 text-sm">
                    No candidates have been added yet for this requisition.
                  </div>
                ) : (
                  <>
                    {/* Filters */}
                    <div className="flex flex-col gap-3 mb-4">
                      {/* Item filter */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-medium text-gray-600">
                          Filter by Position:
                        </span>
                        <select
                          value={
                            candidateItemFilter === "all"
                              ? "all"
                              : candidateItemFilter
                          }
                          onChange={(e) =>
                            setCandidateItemFilter(
                              e.target.value === "all"
                                ? "all"
                                : Number(e.target.value),
                            )
                          }
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs bg-white"
                        >
                          <option value="all">All Positions</option>
                          {requisition.items.map((item) => {
                            const countForItem = candidates.filter(
                              (c) => c.requisition_item_id === item.item_id,
                            ).length;
                            return (
                              <option key={item.item_id} value={item.item_id}>
                                {item.role_position} ({countForItem})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Stage filter */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          "all",
                          "Sourced",
                          "Shortlisted",
                          "Interviewing",
                          "Offered",
                          "Hired",
                          "Rejected",
                        ].map((stage) => {
                          const filteredByItem =
                            candidateItemFilter === "all"
                              ? candidates
                              : candidates.filter(
                                  (c) =>
                                    c.requisition_item_id ===
                                    candidateItemFilter,
                                );
                          const count =
                            stage === "all"
                              ? filteredByItem.length
                              : filteredByItem.filter(
                                  (c) => c.current_stage === stage,
                                ).length;
                          const isActive = candidateStageFilter === stage;
                          return (
                            <button
                              key={stage}
                              type="button"
                              onClick={() => setCandidateStageFilter(stage)}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                                isActive
                                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                  : "border-gray-200 text-gray-600 bg-white"
                              }`}
                            >
                              {stage === "all" ? "All" : stage} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Candidate list */}
                    <div className="space-y-3">
                      {candidates
                        .filter((c) => {
                          if (
                            candidateItemFilter !== "all" &&
                            c.requisition_item_id !== candidateItemFilter
                          ) {
                            return false;
                          }
                          if (
                            candidateStageFilter !== "all" &&
                            c.current_stage !== candidateStageFilter
                          ) {
                            return false;
                          }
                          return true;
                        })
                        .map((c) => {
                          const linkedItem = requisition.items.find(
                            (it) => it.item_id === c.requisition_item_id,
                          );
                          const stageColors: Record<
                            string,
                            { bg: string; text: string }
                          > = {
                            Sourced: {
                              bg: "bg-slate-100 text-slate-700",
                              text: "",
                            },
                            Shortlisted: {
                              bg: "bg-blue-100 text-blue-700",
                              text: "",
                            },
                            Interviewing: {
                              bg: "bg-purple-100 text-purple-700",
                              text: "",
                            },
                            Offered: {
                              bg: "bg-amber-100 text-amber-700",
                              text: "",
                            },
                            Hired: {
                              bg: "bg-emerald-100 text-emerald-700",
                              text: "",
                            },
                            Rejected: {
                              bg: "bg-red-100 text-red-700",
                              text: "",
                            },
                          };
                          const stageClass =
                            stageColors[c.current_stage]?.bg ??
                            "bg-slate-100 text-slate-700";

                          return (
                            <button
                              key={c.candidate_id}
                              type="button"
                              onClick={() => setSelectedCandidate(c)}
                              className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium text-gray-900 text-sm">
                                    {c.full_name}
                                  </div>
                                  <div className="text-xs text-gray-600 mt-1">
                                    {c.email}
                                    {c.phone ? ` • ${c.phone}` : ""}
                                  </div>
                                  {linkedItem && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      Position: {linkedItem.role_position}
                                    </div>
                                  )}
                                </div>
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${stageClass}`}
                                >
                                  {c.current_stage}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ TIMELINE & HISTORY TAB ═══════════════ */}
        {activeTab === "timeline" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content — Timeline */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Master Activity Timeline
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Creation, budget, authorization, assignment and recruitment
                    events
                  </p>
                </div>
                <div className="p-6">
                  {masterTimeline.length === 0 ? (
                    <div className="text-center py-8">
                      <History className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">
                        No activity history available
                      </p>
                    </div>
                  ) : (
                    <MasterTimeline events={masterTimeline} />
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar — JD + Approvals */}
            <div className="space-y-6">
              {/* Job Description PDF */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Job Description
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Attached documents
                  </p>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600">
                    Job descriptions are managed per position. View or upload in the{" "}
                    <button
                      type="button"
                      onClick={() => setActiveTab("positions")}
                      className="text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Positions
                    </button>{" "}
                    tab.
                  </p>
                </div>
              </div>

              {/* Approval Information */}
              {(requisition.budget_approved_at ||
                requisition.hr_approved_at) && (
                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Approval Details
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Review and approval information
                    </p>
                  </div>
                  <div className="p-6 space-y-4">
                    {requisition.budget_approved_at && (
                      <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                        <div>
                          <div className="font-medium text-gray-900">
                            Budget Approved
                          </div>
                          <div className="text-sm text-gray-600">
                            Approved on:{" "}
                            {formatDateTime(requisition.budget_approved_at)}
                          </div>
                        </div>
                      </div>
                    )}

                    {requisition.hr_approved_at && (
                      <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                        <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div>
                          <div className="font-medium text-gray-900">
                            HR Approved
                          </div>
                          <div className="text-sm text-gray-600">
                            Approved on:{" "}
                            {formatDateTime(requisition.hr_approved_at)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Candidate Detail Modal (read-only actions for Manager) */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onUpdate={(updated) => {
            setCandidates((prev) =>
              prev.map((c) =>
                c.candidate_id === updated.candidate_id ? updated : c,
              ),
            );
            setSelectedCandidate(null);
          }}
          userRoles={user?.roles || []}
        />
      )}

      {/* JD PDF Viewer Modal (view on spot, same pattern as candidate resume) */}
      {showJdViewer && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeJdViewer()}
        >
          <div
            className="bg-white rounded-xl shadow-xl flex flex-col"
            style={{ width: "90%", maxWidth: "900px", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                Job Description
              </h3>
              <div className="flex items-center gap-2">
                {jdBlobUrl && (
                  <a
                    href={jdBlobUrl}
                    download={jdItemId
                      ? `JD_${requisition?.items?.find((i) => i.item_id === jdItemId)?.role_position ?? jdItemId}.pdf`
                      : `JD_REQ-${requisition?.req_id ?? "requisition"}.pdf`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </a>
                )}
                <button
                  onClick={closeJdViewer}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-auto">
              {loadingJd ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
                  <p className="text-sm">Loading PDF...</p>
                </div>
              ) : jdBlobUrl ? (
                <iframe
                  src={jdBlobUrl}
                  title="Job Description PDF"
                  className="w-full rounded-lg border border-gray-200"
                  style={{ height: "75vh" }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <FileText className="h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-sm">Could not load PDF.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerRequisitionDetails;
