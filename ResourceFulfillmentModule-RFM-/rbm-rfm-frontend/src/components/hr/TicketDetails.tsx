// components/hr/TicketDetail.tsx
import React, { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Calendar,
  Users,
  Target,
  Clock,
  CheckCircle,
  FileText,
  MessageSquare,
  History,
  Download,
  Printer,
  ExternalLink,
  Shield,
  Edit,
  Save,
  X,
  UserPlus,
  Search,
  Filter,
  AlertCircle,
  Briefcase,
  Award,
  GraduationCap,
  MapPin,
  ChevronDown,
  ChevronUp,
  DollarSign,
  UserCog,
  ArrowRightLeft,
  RefreshCw,
  Eye,
} from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import HRGatekeeperPanel from "./HRGatekeeperPanel";
import ReassignTAModal from "./ReassignTAModal";
import type {
  Requisition as WorkflowRequisition,
  RequisitionItem as WorkflowRequisitionItem,
} from "../../types/workflow";
import { useAuth } from "../../contexts/useAuth";
import {
  fetchCandidates,
  createCandidate,
  uploadResume,
  getCandidateActionErrorMessage,
  type Candidate,
} from "../../api/candidateApi";
import CandidateDetailModal from "../shared/CandidateDetailModal";

interface TicketDetailsProps {
  ticketId?: string | null;
  onBack?: () => void;
  onUpdate?: (ticket: any) => void;
}

interface RequisitionItem {
  id: string;
  numericItemId: number;
  skill: string;
  level: string;
  experience: number;
  education: string;
  itemStatus: string;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  assignedDate?: string;
  assignedTAId?: number | null;
  description: string;
  requirements?: string;
  replacementHire?: boolean;
  replacedEmpId?: string | null;
  estimatedBudget?: number | null;
  approvedBudget?: number | null;
  currency?: string;
  jdFileKey?: string | null;
}

interface TimelineEvent {
  date: string;
  event: string;
  user: string;
}

interface NoteEntry {
  date: string;
  user: string;
  text: string;
}

interface TicketData {
  id: string;
  ticketId: string;
  projectName: string;
  projectCode: string;
  client: string;
  projectManager: string;
  requiredBy: string;
  workMode: string;
  location: string;
  priority: string;
  overallStatus: string;
  justification: string;
  dateCreated: string;
  assignedTA: string;
  assignedTAId?: number | null;
  raisedById?: number | null;
  approvedBy?: number | null;
  budgetApprovedBy?: number | null;
  approvalHistory?: string | null;
  assignedAt?: string | null;
  createdAt?: string | null;
  daysOpen: number;
  slaHours: number;
  budget: string;
  projectDuration: string;
  items: RequisitionItem[];
  timeline: TimelineEvent[];
  notes: NoteEntry[];
}

interface BackendRequisitionItem {
  item_id: number;
  req_id: number;
  role_position: string;
  skill_level?: string | null;
  experience_years?: number | null;
  education_requirement?: string | null;
  job_description: string;
  jd_file_key?: string | null;
  requirements?: string | null;
  item_status: string;
  assigned_ta?: number | null;
  replacement_hire?: boolean;
  replaced_emp_id?: string | null;
  estimated_budget?: number | null;
  approved_budget?: number | null;
  currency?: string | null;
}

interface BackendRequisition {
  req_id: number;
  project_name?: string | null;
  client_name?: string | null;
  overall_status: string;
  required_by_date?: string | null;
  priority?: string | null;
  budget_amount?: number | null;
  created_at?: string | null;
  work_mode?: string | null;
  office_location?: string | null;
  justification?: string | null;
  duration?: string | null;
  raised_by?: number | null;
  assigned_ta?: number | null;
  budget_approved_by?: number | null;
  approved_by?: number | null;
  approval_history?: string | null;
  assigned_at?: string | null;
  jd_file_key?: string | null;
  items: BackendRequisitionItem[];
}

interface StatusHistoryEntry {
  history_id: number;
  req_id: number;
  old_status?: string | null;
  new_status?: string | null;
  changed_by?: number | null;
  changed_at: string;
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

interface UserDirectoryEntry {
  user_id: number;
  username: string;
  roles?: string[];
}

const TicketDetail: React.FC<TicketDetailsProps> = ({
  ticketId,
  onBack,
  onUpdate,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const effectiveTicketId = ticketId ?? id;

  // Check if user is HR or Admin for Gatekeeper access
  const isHRRole = (user?.roles || []).some(
    (r) => r.toLowerCase() === "hr" || r.toLowerCase() === "admin",
  );

  // TA can add candidates to:
  // - items explicitly assigned to them, or
  // - items with no item-level TA when they are the header-level TA.
  // HR/Admin can add to any item.
  const canEditItemForAddCandidate = (item: RequisitionItem) => {
    if (isHRRole) return true;
    if (!user?.user_id) return false;

    const headerAssignedToMe =
      ticket?.assignedTAId != null && ticket.assignedTAId === user.user_id;

    if (item.assignedTAId != null) {
      return item.assignedTAId === user.user_id;
    }

    // Unassigned item: allow header-level TA to act as owner.
    return headerAssignedToMe;
  };

  // Raw requisition data for Gatekeeper panel
  const [rawRequisition, setRawRequisition] =
    useState<WorkflowRequisition | null>(null);
  const getTodayDate = () =>
    new Date().toISOString().split("T")[0] ?? new Date().toISOString();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "items" | "candidates" | "timeline" | "gatekeeper"
  >("overview");
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [selectedItemForAssignment, setSelectedItemForAssignment] = useState<
    string | null
  >(null);
  const [newNote, setNewNote] = useState("");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [usersById, setUsersById] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Candidate Pipeline state ----
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    null,
  );
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [addCandidateItemId, setAddCandidateItemId] = useState<number | null>(
    null,
  );
  const [newCandidateName, setNewCandidateName] = useState("");
  const [newCandidateEmail, setNewCandidateEmail] = useState("");
  const [newCandidatePhone, setNewCandidatePhone] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [candidateStageFilter, setCandidateStageFilter] =
    useState<string>("all");
  const [candidateItemFilter, setCandidateItemFilter] = useState<
    number | "all"
  >("all");
  const [candidateError, setCandidateError] = useState<string | null>(null);

  // ---- Phase 7: TA Reassignment state ----
  const [reassignModal, setReassignModal] = useState<{
    mode: "item" | "bulk";
    itemId?: number;
    itemLabel?: string;
    currentTAId: number | null;
  } | null>(null);
  const [bulkOldTAId, setBulkOldTAId] = useState<number | null>(null);

  // JD PDF viewer (item-level only)
  const [showJdViewer, setShowJdViewer] = useState(false);
  const [jdItemId, setJdItemId] = useState<number | null>(null);
  const [jdBlobUrl, setJdBlobUrl] = useState<string | null>(null);
  const [loadingJd, setLoadingJd] = useState(false);

  /** TA users extracted from usersById (populated after fetch) */
  const taUsersList = Object.entries(usersById).map(([id, username]) => ({
    user_id: Number(id),
    username,
  }));

  const parseReqId = (value?: string | null) => {
    if (!value) return null;
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
  };

  const buildTicket = (req: BackendRequisition): TicketData => {
    const createdAt = req.created_at ? new Date(req.created_at) : null;
    const now = new Date();
    const daysOpen = createdAt
      ? Math.max(0, Math.ceil((now.getTime() - createdAt.getTime()) / 86400000))
      : 0;
    const budget = req.budget_amount
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0,
        }).format(req.budget_amount)
      : "—";

    return {
      id: `REQ-${req.req_id}`,
      ticketId: `REQ-${req.req_id}`,
      projectName: req.project_name ?? "—",
      projectCode: `REQ-${req.req_id}`,
      client: req.client_name ?? "—",
      projectManager: req.raised_by ? `User #${req.raised_by}` : "—",
      requiredBy: req.required_by_date ?? "",
      workMode: req.work_mode ?? "—",
      location: req.office_location ?? "—",
      priority: req.priority ?? "—",
      overallStatus: req.overall_status ?? "—",
      justification: req.justification ?? "—",
      dateCreated: req.created_at ?? "",
      raisedById: req.raised_by ?? null,
      assignedTA: req.assigned_ta ? `User #${req.assigned_ta}` : "Unassigned",
      assignedTAId: req.assigned_ta ?? null,
      approvedBy: req.approved_by ?? null,
      budgetApprovedBy: req.budget_approved_by ?? null,
      approvalHistory: req.approval_history ?? null,
      assignedAt: req.assigned_at ?? null,
      createdAt: req.created_at ?? null,
      daysOpen,
      slaHours: 72,
      budget,
      projectDuration: req.duration ?? "—",
      items:
        req.items?.map((item) => ({
          id: `ITEM-${item.item_id}`,
          numericItemId: item.item_id,
          skill: item.role_position,
          level: item.skill_level ?? "—",
          experience: item.experience_years ?? 0,
          education: item.education_requirement ?? "—",
          itemStatus: item.item_status,
          assignedTAId: item.assigned_ta ?? null,
          description: item.job_description,
          requirements: item.requirements ?? undefined,
          replacementHire: item.replacement_hire ?? false,
          replacedEmpId: item.replaced_emp_id ?? null,
          estimatedBudget: item.estimated_budget ?? null,
          approvedBudget: item.approved_budget ?? null,
          currency: item.currency ?? "INR",
          jdFileKey: (item as BackendRequisitionItem).jd_file_key ?? null,
        })) ?? [],
      timeline: [],
      notes: [],
    };
  };

  const parseSecondarySkills = (requirements?: string) => {
    if (!requirements) return [] as string[];
    const match = requirements.match(/Secondary Skills:\s*([^|]+)/i);
    const matched = match?.[1];
    if (!matched) return [] as string[];
    return matched
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean);
  };

  const parsePrimarySkill = (requirements?: string) => {
    if (!requirements) return null;
    const match = requirements.match(/Primary Skill:\s*([^|]+)/i);
    return match?.[1]?.trim() ?? null;
  };

  const formatItemBudget = (
    amount: number | null | undefined,
    currency: string = "INR",
  ) => {
    if (amount == null || amount === 0) return "—";
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString()}`;
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  };

  const formatDateTime = (dateValue?: string | null) => {
    if (!dateValue) return "—";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatRelativeTime = (dateValue?: string | null) => {
    if (!dateValue) return "—";
    const date = new Date(dateValue);
    const diffMs = Date.now() - date.getTime();
    if (Number.isNaN(diffMs)) return "—";
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24)
      return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  };

  const resolveUserName = (userId?: number | null) => {
    if (!userId) return "System";
    return usersById[userId] ?? `User #${userId}`;
  };

  const parseBudgetNote = () => {
    const budgetLog = auditLogs.find((log) => log.action === "BUDGET_UPDATE");
    if (!budgetLog?.new_value) return undefined;
    try {
      const newValue = JSON.parse(budgetLog.new_value);
      const oldValue = budgetLog.old_value
        ? JSON.parse(budgetLog.old_value)
        : {};
      if (newValue?.budget_amount !== undefined) {
        return `Budget updated from ${oldValue?.budget_amount ?? "—"} to ${newValue.budget_amount}.`;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  useEffect(() => {
    let isMounted = true;
    const reqId = parseReqId(effectiveTicketId);

    if (!reqId) {
      setError("Invalid requisition id");
      setIsLoading(false);
      return;
    }

    const fetchRequisition = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await apiClient.get<BackendRequisition>(
          `/requisitions/${reqId}`,
        );
        if (isMounted) {
          const data = response.data;
          setTicket(buildTicket(data));

          // Store raw data for Gatekeeper panel
          const workflowReq: WorkflowRequisition = {
            req_id: data.req_id,
            project_name: data.project_name ?? null,
            client_name: data.client_name ?? null,
            overall_status:
              data.overall_status as WorkflowRequisition["overall_status"],
            required_by_date: data.required_by_date ?? null,
            priority: data.priority ?? null,
            budget_amount: data.budget_amount ?? null,
            created_at: data.created_at ?? null,
            work_mode: data.work_mode ?? null,
            office_location: data.office_location ?? null,
            justification: data.justification ?? null,
            duration: data.duration ?? null,
            is_replacement: null,
            manager_notes: null,
            rejection_reason: null,
            jd_file_key: null,
            raised_by: data.raised_by ?? 0,
            assigned_ta: data.assigned_ta ?? null,
            budget_approved_by: data.budget_approved_by ?? null,
            approved_by: data.approved_by ?? null,
            approval_history: data.approval_history ?? null,
            assigned_at: data.assigned_at ?? null,
            total_items: data.items?.length ?? 0,
            fulfilled_items:
              data.items?.filter((i) => i.item_status === "Fulfilled").length ??
              0,
            cancelled_items:
              data.items?.filter((i) => i.item_status === "Cancelled").length ??
              0,
            active_items:
              data.items?.filter(
                (i) =>
                  i.item_status !== "Fulfilled" &&
                  i.item_status !== "Cancelled",
              ).length ?? 0,
            progress_ratio: null,
            progress_text: null,
            total_estimated_budget: 0,
            total_approved_budget: 0,
            budget_approval_status: null,
            items: (data.items || []).map((item) => {
              const extItem = item as BackendRequisitionItem & {
                estimated_budget?: number | null;
                approved_budget?: number | null;
                currency?: string | null;
                replacement_hire?: boolean;
                replaced_emp_id?: string | null;
                assigned_ta?: number | null;
                assigned_emp_id?: string | null;
              };
              return {
                item_id: item.item_id,
                req_id: item.req_id,
                role_position: item.role_position,
                skill_level: item.skill_level ?? null,
                experience_years: item.experience_years ?? null,
                education_requirement: item.education_requirement ?? null,
                job_description: item.job_description,
                jd_file_key: (item as BackendRequisitionItem).jd_file_key ?? null,
                requirements: item.requirements ?? null,
                item_status:
                  item.item_status as WorkflowRequisitionItem["item_status"],
                replacement_hire: extItem.replacement_hire ?? false,
                replaced_emp_id: extItem.replaced_emp_id ?? null,
                estimated_budget: extItem.estimated_budget ?? null,
                approved_budget: extItem.approved_budget ?? null,
                currency: extItem.currency ?? "INR",
                assigned_ta: extItem.assigned_ta ?? null,
                assigned_emp_id: extItem.assigned_emp_id ?? null,
              };
            }),
          };

          // Calculate totals
          workflowReq.total_estimated_budget = workflowReq.items.reduce(
            (sum, item) => sum + (item.estimated_budget || 0),
            0,
          );
          workflowReq.total_approved_budget = workflowReq.items.reduce(
            (sum, item) => sum + (item.approved_budget || 0),
            0,
          );

          setRawRequisition(workflowReq);

          // Auto-switch to Gatekeeper tab if status is Pending_Budget and user is HR
          if (data.overall_status === "Pending_Budget" && isHRRole) {
            setActiveTab("gatekeeper");
          }
        }
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load requisition";
        setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const fetchStatusHistory = async () => {
      try {
        const response = await apiClient.get<StatusHistoryEntry[]>(
          `/requisitions/${reqId}/status-history`,
        );
        if (isMounted) {
          setStatusHistory(response.data ?? []);
        }
      } catch {
        if (isMounted) setStatusHistory([]);
      }
    };

    const fetchAuditLogs = async () => {
      try {
        const response = await apiClient.get<AuditLogEntry[]>(
          `/audit-logs?entity_name=requisition&entity_id=${reqId}`,
        );
        if (isMounted) {
          setAuditLogs(response.data ?? []);
        }
      } catch {
        if (isMounted) setAuditLogs([]);
      }
    };

    const fetchUsers = async () => {
      try {
        const response = await apiClient.get<UserDirectoryEntry[]>("/users");
        if (!isMounted) return;
        const map: Record<number, string> = {};
        response.data.forEach((userEntry) => {
          map[userEntry.user_id] = userEntry.username;
        });
        setUsersById(map);
      } catch {
        if (isMounted) setUsersById({});
      }
    };

    fetchRequisition();
    fetchStatusHistory();
    fetchAuditLogs();
    fetchUsers();

    return () => {
      isMounted = false;
    };
  }, [effectiveTicketId]);

  // ---- Load candidates when requisition is available ----
  const loadCandidates = useCallback(async () => {
    const reqId = parseReqId(effectiveTicketId);
    if (!reqId) return;
    setCandidatesLoading(true);
    try {
      const data = await fetchCandidates(reqId);
      setCandidates(data);
    } catch {
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  }, [effectiveTicketId]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // ---- Add candidate handler ----
  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || !addCandidateItemId) return;
    setAddingCandidate(true);
    setCandidateError(null);
    try {
      let resumePath: string | undefined;
      if (resumeFile) {
        const uploaded = await uploadResume(resumeFile);
        resumePath = uploaded.filename;
      }
      const reqId = parseReqId(effectiveTicketId);
      if (!reqId) return;
      await createCandidate({
        requisition_item_id: addCandidateItemId,
        requisition_id: reqId,
        full_name: newCandidateName.trim(),
        email: newCandidateEmail.trim(),
        phone: newCandidatePhone.trim() || undefined,
        resume_path: resumePath,
      });
      setNewCandidateName("");
      setNewCandidateEmail("");
      setNewCandidatePhone("");
      setResumeFile(null);
      setShowAddCandidate(false);
      setAddCandidateItemId(null);
      await loadCandidates();
    } catch (err: any) {
      setCandidateError(
        getCandidateActionErrorMessage(err, "Failed to add candidate"),
      );
    } finally {
      setAddingCandidate(false);
    }
  };

  // Refresh data callback for Gatekeeper panel
  // IMPORTANT: This hook must be called before any early returns
  const handleRefreshData = useCallback(async () => {
    const reqId = parseReqId(effectiveTicketId);
    if (!reqId) return;

    try {
      // Phase 7: Add cache-busting timestamp to ensure fresh data after reassignment
      const response = await apiClient.get<BackendRequisition>(
        `/requisitions/${reqId}?_t=${Date.now()}`,
      );
      const data = response.data;
      setTicket(buildTicket(data));

      // Update raw data for Gatekeeper panel
      const workflowReq: WorkflowRequisition = {
        req_id: data.req_id,
        project_name: data.project_name ?? null,
        client_name: data.client_name ?? null,
        overall_status:
          data.overall_status as WorkflowRequisition["overall_status"],
        required_by_date: data.required_by_date ?? null,
        priority: data.priority ?? null,
        budget_amount: data.budget_amount ?? null,
        created_at: data.created_at ?? null,
        work_mode: data.work_mode ?? null,
        office_location: data.office_location ?? null,
        justification: data.justification ?? null,
        duration: data.duration ?? null,
        is_replacement: null,
        manager_notes: null,
        rejection_reason: null,
        jd_file_key: data.jd_file_key ?? null,
        raised_by: data.raised_by ?? 0,
        assigned_ta: data.assigned_ta ?? null,
        budget_approved_by: data.budget_approved_by ?? null,
        approved_by: data.approved_by ?? null,
        approval_history: data.approval_history ?? null,
        assigned_at: data.assigned_at ?? null,
        total_items: data.items?.length ?? 0,
        fulfilled_items:
          data.items?.filter((i) => i.item_status === "Fulfilled").length ?? 0,
        cancelled_items:
          data.items?.filter((i) => i.item_status === "Cancelled").length ?? 0,
        active_items:
          data.items?.filter(
            (i) =>
              i.item_status !== "Fulfilled" && i.item_status !== "Cancelled",
          ).length ?? 0,
        progress_ratio: null,
        progress_text: null,
        total_estimated_budget: 0,
        total_approved_budget: 0,
        budget_approval_status: null,
        items: (data.items || []).map((item) => {
          const extItem = item as BackendRequisitionItem & {
            estimated_budget?: number | null;
            approved_budget?: number | null;
            currency?: string | null;
            replacement_hire?: boolean;
            replaced_emp_id?: string | null;
            assigned_ta?: number | null;
            assigned_emp_id?: string | null;
          };
          return {
            item_id: item.item_id,
            req_id: item.req_id,
            role_position: item.role_position,
            skill_level: item.skill_level ?? null,
            experience_years: item.experience_years ?? null,
            education_requirement: item.education_requirement ?? null,
            job_description: item.job_description,
            jd_file_key: (item as BackendRequisitionItem).jd_file_key ?? null,
            requirements: item.requirements ?? null,
            item_status:
              item.item_status as WorkflowRequisitionItem["item_status"],
            replacement_hire: extItem.replacement_hire ?? false,
            replaced_emp_id: extItem.replaced_emp_id ?? null,
            estimated_budget: extItem.estimated_budget ?? null,
            approved_budget: extItem.approved_budget ?? null,
            currency: extItem.currency ?? "INR",
            assigned_ta: extItem.assigned_ta ?? null,
            assigned_emp_id: extItem.assigned_emp_id ?? null,
          };
        }),
      };

      workflowReq.total_estimated_budget = workflowReq.items.reduce(
        (sum, item) => sum + (item.estimated_budget || 0),
        0,
      );
      workflowReq.total_approved_budget = workflowReq.items.reduce(
        (sum, item) => sum + (item.approved_budget || 0),
        0,
      );

      setRawRequisition(workflowReq);

      // If status changed from Pending_Budget, switch to overview
      if (
        data.overall_status !== "Pending_Budget" &&
        activeTab === "gatekeeper"
      ) {
        setActiveTab("overview");
      }
    } catch (err) {
      // Silent refresh error
      console.error("Failed to refresh requisition:", err);
    }
  }, [effectiveTicketId, activeTab]);

  // Load JD PDF for viewer when modal opens (item-level endpoint)
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

  if (isLoading) {
    return (
      <div className="data-table-container">
        <div className="tickets-empty-state">Loading requisition…</div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="data-table-container">
        <div className="tickets-empty-state" style={{ color: "var(--error)" }}>
          {error ?? "Requisition not found"}
        </div>
      </div>
    );
  }

  const statusHistoryByStatus = statusHistory.reduce(
    (acc, entry) => {
      if (entry.new_status) {
        acc[entry.new_status] = entry;
      }
      return acc;
    },
    {} as Record<string, StatusHistoryEntry>,
  );

  const budgetNote = parseBudgetNote();

  const milestones = (() => {
    const steps: {
      id: string;
      title: string;
      actor: string;
      time?: string | null;
      note?: string;
      forceCompleted?: boolean;
    }[] = [];

    steps.push({
      id: "raised",
      title: "Requisition Raised",
      actor: resolveUserName(ticket.raisedById),
      time: ticket.createdAt ?? ticket.dateCreated,
    });

    if (ticket.budgetApprovedBy) {
      const budgetLog = auditLogs.find((log) => log.action === "BUDGET_UPDATE");
      const budgetTime =
        statusHistoryByStatus["Pending HR Approval"]?.changed_at ??
        budgetLog?.performed_at ??
        ticket.createdAt ??
        null;
      steps.push({
        id: "budget",
        title: "Budget Cleared",
        actor: resolveUserName(ticket.budgetApprovedBy),
        time: budgetTime,
        note: budgetNote,
      });
    }

    if (ticket.approvedBy) {
      steps.push({
        id: "hr",
        title: "Validated by HR Admin",
        actor: resolveUserName(ticket.approvedBy),
        time: ticket.approvalHistory ?? null,
      });
    }

    if (ticket.assignedTAId) {
      const taAssignLog = auditLogs.find((log) => log.action === "TA_ASSIGN");
      steps.push({
        id: "ta",
        title: `Assigned to ${resolveUserName(ticket.assignedTAId)}`,
        actor:
          taAssignLog?.performed_by_full_name ||
          taAssignLog?.performed_by_username ||
          resolveUserName(taAssignLog?.performed_by),
        time: ticket.assignedAt ?? taAssignLog?.performed_at ?? null,
      });
    }

    const fulfilledItems = ticket.items.filter(
      (item) => item.itemStatus === "Fulfilled",
    );
    fulfilledItems.forEach((item) => {
      steps.push({
        id: `fulfilled-${item.id}`,
        title: `Position Fulfilled: ${item.skill}`,
        actor: item.assignedEmployeeName ?? "Assigned employee",
        time: null,
        note: "Fulfillment time not available in current data.",
        forceCompleted: true,
      });
    });

    // F-002 FIX: Use "Fulfilled" instead of "Closed"
    if (ticket.overallStatus === "Fulfilled") {
      steps.push({
        id: "fulfilled",
        title: "Requisition Fulfilled",
        actor: resolveUserName(statusHistoryByStatus["Fulfilled"]?.changed_by),
        time: statusHistoryByStatus["Fulfilled"]?.changed_at ?? null,
      });
    }

    return steps;
  })();

  const firstPendingIndex = milestones.findIndex(
    (step) => !step.time && !step.forceCompleted,
  );
  const timelineWithStatus = milestones.map((step, index) => {
    const previous = milestones[index - 1];
    const timeValue = step.time ? new Date(step.time).getTime() : null;
    const previousTime = previous?.time
      ? new Date(previous.time).getTime()
      : null;
    const isDelayed =
      timeValue !== null &&
      previousTime !== null &&
      timeValue - previousTime > 48 * 60 * 60 * 1000;
    return {
      ...step,
      isDelayed,
      isCompleted:
        step.forceCompleted ||
        (firstPendingIndex === -1 ? true : index < firstPendingIndex),
      isCurrent: firstPendingIndex !== -1 && index === firstPendingIndex,
      isUpcoming: firstPendingIndex !== -1 && index > firstPendingIndex,
    };
  });

  // Calculate completion stats from real ticket.items
  const fulfilled = ticket.items.filter(
    (item) => item.itemStatus === "Fulfilled",
  ).length;
  const cancelled = ticket.items.filter(
    (item) => item.itemStatus === "Cancelled",
  ).length;
  const openPositions = ticket.items.filter(
    (item) =>
      item.itemStatus !== "Fulfilled" && item.itemStatus !== "Cancelled",
  ).length;
  const completionStats = {
    totalItems: ticket.items.length,
    fulfilled,
    pending: ticket.items.filter((item) => item.itemStatus === "Pending")
      .length,
    cancelled,
    openPositions,
    progress:
      ticket.items.length > 0
        ? Math.round(
            ((fulfilled + cancelled) / ticket.items.length) * 100,
          )
        : 0,
  };

  // Handle item status change
  const handleItemStatusChange = (
    itemId: string,
    newStatus: RequisitionItem["itemStatus"],
  ) => {
    if (!ticket) return;
    const updatedItems = ticket.items.map((item) =>
      item.id === itemId ? { ...item, itemStatus: newStatus } : item,
    );
    setTicket({ ...ticket, items: updatedItems });

    // Update overall status if all items are done
    // F-002 FIX: Use "Fulfilled" instead of "Closed"
    const allItemsDone = updatedItems.every(
      (item) =>
        item.itemStatus === "Fulfilled" || item.itemStatus === "Cancelled",
    );
    if (allItemsDone) {
      setTicket((prev) =>
        prev ? { ...prev, overallStatus: "Fulfilled" } : prev,
      );
    }
  };

  // Handle employee assignment
  const handleAssignEmployee = (itemId: string, employeeId: string) => {
    // Legacy stub — assignments now go through the Candidate Pipeline
  };

  // Toggle item expansion
  const toggleItemExpansion = (itemId: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    );
  };

  // Save changes
  const handleSave = () => {
    setIsEditing(false);
    if (onUpdate) {
      onUpdate(ticket);
    }
  };

  // Cancel editing
  const handleCancel = () => {
    setIsEditing(false);
  };

  // Add new note
  const handleAddNote = () => {
    if (!newNote.trim()) return;

    const newNoteObj = {
      date: getTodayDate(),
      user: "Current User",
      text: newNote,
    };

    setTicket((prev) =>
      prev ? { ...prev, notes: [...prev.notes, newNoteObj] } : prev,
    );
    setNewNote("");
  };

  // Check if Gatekeeper tab should be shown
  const showGatekeeperTab =
    isHRRole &&
    (ticket?.overallStatus === "Pending_Budget" ||
      ticket?.overallStatus === "Pending Budget Approval");

  // Tabs
  const tabs = [
    ...(showGatekeeperTab
      ? [
          {
            id: "gatekeeper" as const,
            label: "Gatekeeper",
            icon: <DollarSign size={16} />,
          },
        ]
      : []),
    {
      id: "overview" as const,
      label: "Overview",
      icon: <FileText size={16} />,
    },
    {
      id: "items" as const,
      label: "Requisition Items",
      icon: <Briefcase size={16} />,
    },
    {
      id: "candidates" as const,
      label: "Candidates",
      icon: <UserPlus size={16} />,
    },
    { id: "timeline" as const, label: "Timeline", icon: <History size={16} /> },
  ];

  return (
    <div className="admin-content-area">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => (onBack ? onBack() : navigate("/hr/requisitions"))}
            className="action-button"
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            <ArrowLeft size={16} />
            Back to Requisitions
          </button>
          <div>
            <h1
              style={{ fontSize: "20px", fontWeight: 600, marginBottom: "2px" }}
            >
              Requisition Details
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
              Manage and update resource requirements
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!isEditing ? (
            <button
              className="action-button primary"
              onClick={() => setIsEditing(true)}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <Edit size={16} />
              Edit Requisition
            </button>
          ) : (
            <>
              <button
                className="action-button"
                onClick={handleCancel}
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <X size={16} />
                Cancel
              </button>
              <button
                className="action-button primary"
                onClick={handleSave}
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Save size={16} />
                Save Changes
              </button>
            </>
          )}
          {/* <button className="action-button">
            <Download size={16} />
          </button>
          <button className="action-button">
            <Printer size={16} />
          </button> */}
        </div>
      </div>

      {/* Status & Progress */}
      <div
        style={{
          padding: "20px",
          marginBottom: "24px",
          backgroundColor: "var(--bg-primary)",
          borderRadius: "16px",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                fontFamily: "monospace",
              }}
            >
              {ticket.ticketId}
            </div>
            <span
              className={`ticket-status ${ticket.overallStatus.toLowerCase().replace(" ", "-")}`}
            >
              {ticket.overallStatus}
            </span>
            <span
              className={`priority-indicator priority-${ticket.priority.toLowerCase()}`}
            >
              {ticket.priority} Priority
            </span>
            <span
              className={`aging-indicator ${ticket.daysOpen <= 7 ? "aging-0-7" : ticket.daysOpen <= 30 ? "aging-8-30" : "aging-30-plus"}`}
            >
              {ticket.daysOpen} days open
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            Required by: {ticket.requiredBy}
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              Completion Progress
            </span>
            <span style={{ fontSize: "14px", fontWeight: 600 }}>
              {completionStats.progress}%
            </span>
          </div>
          <div
            style={{
              height: "8px",
              background: "var(--border-subtle)",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${completionStats.progress}%`,
                height: "100%",
                background:
                  "linear-gradient(135deg, var(--primary-accent), var(--primary-accent-dark))",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "8px",
              fontSize: "12px",
              color: "var(--text-tertiary)",
            }}
          >
            <span> {completionStats.fulfilled} Fulfilled</span>
            <span> {completionStats.pending} Pending</span>
            <span> {completionStats.cancelled} Cancelled</span>
            <span> {completionStats.totalItems} Total Positions</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          padding: "4px",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "12px",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "8px",
              border: "none",
              background:
                activeTab === tab.id ? "var(--bg-primary)" : "transparent",
              color:
                activeTab === tab.id
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "all 0.2s ease",
              boxShadow: activeTab === tab.id ? "var(--shadow-sm)" : "none",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content based on active tab */}
      {activeTab === "gatekeeper" && rawRequisition && (
        <HRGatekeeperPanel
          requisition={rawRequisition}
          onRefresh={handleRefreshData}
          onApprovalComplete={() => {
            // Refresh data and switch to overview after approval completes
            handleRefreshData();
          }}
        />
      )}

      {activeTab === "overview" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "24px",
          }}
        >
          {/* Left Column - Basic Info */}
          <div>
            <div className="master-data-manager">
              <div className="data-manager-header">
                <h2>Project & Client Details</h2>
                <p className="subtitle">
                  Complete project information and requirements
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "24px",
                  marginBottom: "24px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      marginBottom: "12px",
                    }}
                  >
                    Project Information
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Project Name:
                      </span>
                      <span style={{ fontWeight: 500 }}>
                        {ticket.projectName}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Project Code:
                      </span>
                      <span style={{ fontFamily: "monospace" }}>
                        {ticket.projectCode}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Client:
                      </span>
                      <span style={{ fontWeight: 500 }}>{ticket.client}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Raised By:
                      </span>
                      <span>{resolveUserName(ticket.raisedById)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      marginBottom: "12px",
                    }}
                  >
                    Logistics
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Work Mode:
                      </span>
                      <span style={{ fontWeight: 500 }}>{ticket.workMode}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Location:
                      </span>
                      <span>{ticket.location}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Project Duration:
                      </span>
                      <span>{ticket.projectDuration}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Budget:
                      </span>
                      <span style={{ fontWeight: 500 }}>
                        {formatItemBudget(
                          ticket.items.reduce(
                            (sum, item) =>
                              sum +
                              (item.approvedBudget ??
                                item.estimatedBudget ??
                                0),
                            0
                          ),
                          ticket.items[0]?.currency ?? "INR"
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: "24px" }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "8px",
                  }}
                >
                  Business Justification
                </div>
                <div
                  style={{
                    padding: "16px",
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <p
                    style={{
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {ticket.justification}
                  </p>
                </div>
              </div>

              {/* Assignment Info */}
              <div
                style={{
                  padding: "20px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "12px",
                  }}
                >
                  Assignment Details
                </div>
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
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                      }}
                    >
                      <Users size={14} />
                      <span style={{ color: "var(--text-secondary)" }}>
                        Assigned TA:
                      </span>
                    </div>
                    <span style={{ fontWeight: 500 }}>{ticket.assignedTA}</span>
                  </div>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                      }}
                    >
                      <Calendar size={14} />
                      <span style={{ color: "var(--text-secondary)" }}>
                        Date Created:
                      </span>
                    </div>
                    <span>{formatDateTime(ticket.dateCreated)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Quick Stats & Actions */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "24px" }}
          >
            {/* Quick Stats */}
            <div className="audit-log-viewer">
              <div className="viewer-header">
                <h2>Quick Stats</h2>
                <p className="subtitle">Requisition metrics at a glance</p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    Days Open
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {ticket.daysOpen} day{ticket.daysOpen !== 1 ? "s" : ""}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    Completion
                  </span>
                  <span style={{ color: "var(--success)", fontWeight: 600 }}>
                    {completionStats.progress}%
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    Open Positions
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {completionStats.openPositions} of {completionStats.totalItems}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="audit-log-viewer">
              <div className="viewer-header">
                <h2>Quick Actions</h2>
                <p className="subtitle">HR operations</p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  marginTop: "16px",
                }}
              >
                <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => setActiveTab("candidates")}
                >
                  <Users size={16} />
                  View Candidates
                </button>
                <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => setActiveTab("items")}
                >
                  <Briefcase size={16} />
                  Manage Requisition Items
                </button>
                <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => {
                    setActiveTab("timeline");
                    setIsEditing(true);
                  }}
                >
                  <MessageSquare size={16} />
                  Add Internal Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "items" && (
        <div className="master-data-manager">
          <div
            className="data-manager-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2>Requisition Items Management</h2>
              <p className="subtitle">
                Manage individual positions - Update status or assign resources
              </p>
            </div>

            {/* Phase 7: Bulk Change TA — HR Admin only */}
            {isHRRole &&
              ticket.items.some(
                (i) =>
                  i.itemStatus !== "Fulfilled" &&
                  i.itemStatus !== "Cancelled" &&
                  i.assignedTAId,
              ) && (
                <button
                  className="action-button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                    padding: "10px 16px",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => {
                    // Find the most common currently assigned TA for pre-selection
                    const taCounts: Record<number, number> = {};
                    ticket.items.forEach((i) => {
                      if (
                        i.assignedTAId &&
                        i.itemStatus !== "Fulfilled" &&
                        i.itemStatus !== "Cancelled"
                      ) {
                        taCounts[i.assignedTAId] =
                          (taCounts[i.assignedTAId] ?? 0) + 1;
                      }
                    });
                    const topTA = Object.entries(taCounts).sort(
                      (a, b) => b[1] - a[1],
                    )[0];
                    const defaultOldTA = topTA ? Number(topTA[0]) : null;
                    setBulkOldTAId(defaultOldTA);
                    setReassignModal({
                      mode: "bulk",
                      currentTAId: defaultOldTA,
                    });
                  }}
                >
                  <ArrowRightLeft size={14} />
                  Bulk Change TA
                </button>
              )}
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {ticket.items.map((item) => {
              const isExpanded = expandedItems.includes(item.id);
              const secondarySkills = parseSecondarySkills(item.requirements);
              const primarySkill =
                parsePrimarySkill(item.requirements) ?? item.skill;
              const itemCandidates = candidates.filter(
                (c) => c.requisition_item_id === item.numericItemId,
              );

              return (
                <div
                  key={item.id}
                  style={{
                    padding: "20px",
                    backgroundColor: "var(--bg-primary)",
                    borderRadius: "12px",
                    border:
                      selectedItemForAssignment === item.id
                        ? "2px solid var(--primary-accent)"
                        : "1px solid var(--border-subtle)",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "8px",
                        }}
                      >
                        <span
                          className={
                            item.itemStatus === "Pending"
                              ? "ticket-status open"
                              : item.itemStatus === "Fulfilled"
                                ? "ticket-status fulfilled"
                                : "ticket-status closed"
                          }
                        >
                          {item.itemStatus}
                        </span>
                        <strong style={{ fontSize: "15px" }}>
                          {item.skill} ({item.level})
                        </strong>
                        {/* Replacement badge */}
                        {item.replacementHire && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              backgroundColor: "rgba(245, 158, 11, 0.1)",
                              color: "var(--warning)",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            <RefreshCw size={10} />
                            Replacement
                          </span>
                        )}
                        {item.jdFileKey && (
                          <span style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                            <button
                              type="button"
                              className="action-button"
                              style={{ fontSize: "11px", padding: "4px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                              onClick={() => openJdViewerForItem(item.numericItemId)}
                            >
                              <Eye size={12} />
                              View JD
                            </button>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                apiClient
                                  .get(`/requisitions/items/${item.numericItemId}/jd`, { responseType: "blob" })
                                  .then((res) => {
                                    const url = URL.createObjectURL(res.data as Blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `JD_${item.skill}_${item.numericItemId}.pdf`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  })
                                  .catch(() => {});
                              }}
                              className="action-button"
                              style={{ fontSize: "11px", padding: "4px 8px", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none", color: "inherit" }}
                            >
                              <Download size={12} />
                              Download
                            </a>
                          </span>
                        )}
                      </div>

                      {/* Skills */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          marginBottom: "8px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "var(--text-tertiary)",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Primary:
                          </span>
                          <span
                            style={{
                              padding: "3px 10px",
                              borderRadius: "6px",
                              backgroundColor: "rgba(99, 102, 241, 0.1)",
                              color: "var(--primary-accent)",
                              fontWeight: 600,
                              fontSize: "12px",
                            }}
                          >
                            {primarySkill}
                          </span>
                        </div>
                        {secondarySkills.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "var(--text-tertiary)",
                                textTransform: "uppercase",
                                letterSpacing: "0.03em",
                              }}
                            >
                              Secondary:
                            </span>
                            {secondarySkills.map((skill) => (
                              <span
                                key={skill}
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: "6px",
                                  backgroundColor: "var(--bg-tertiary)",
                                  border: "1px solid var(--border-subtle)",
                                  fontSize: "12px",
                                  color: "var(--text-secondary)",
                                  fontWeight: 500,
                                }}
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(150px, 1fr))",
                          gap: "12px",
                          marginTop: "4px",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Experience
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: "var(--text-primary)",
                              fontWeight: 500,
                            }}
                          >
                            {item.experience} years
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Education
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: "var(--text-primary)",
                              fontWeight: 500,
                            }}
                          >
                            {item.education}
                          </div>
                        </div>
                        {/* <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Assigned To
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: item.assignedEmployeeName
                                ? "var(--text-primary)"
                                : "var(--text-tertiary)",
                              fontWeight: 500,
                            }}
                          >
                            {item.assignedEmployeeName || "Unassigned"}
                          </div>
                        </div> */}
                        <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            TA Assignment
                          </div>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              backgroundColor: item.assignedTAId
                                ? "rgba(59, 130, 246, 0.08)"
                                : "rgba(245, 158, 11, 0.08)",
                              color: item.assignedTAId
                                ? "var(--primary-accent)"
                                : "var(--warning)",
                              fontSize: "12px",
                              fontWeight: 500,
                            }}
                          >
                            <UserCog size={11} />
                            {item.assignedTAId
                              ? `${usersById[item.assignedTAId] ?? `#${item.assignedTAId}`}`
                              : "Not Assigned"}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Type
                          </div>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "13px",
                              fontWeight: 500,
                              color: item.replacementHire
                                ? "var(--warning)"
                                : "var(--success)",
                            }}
                          >
                            {item.replacementHire ? (
                              <>
                                <RefreshCw size={11} />
                                Replacement
                                {item.replacedEmpId && (
                                  <span
                                    style={{
                                      color: "var(--text-tertiary)",
                                      fontSize: "11px",
                                      fontWeight: 400,
                                    }}
                                  >
                                    ({item.replacedEmpId})
                                  </span>
                                )}
                              </>
                            ) : (
                              "New Hire"
                            )}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "var(--text-tertiary)",
                              marginBottom: "2px",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Est. Budget
                          </div>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "13px",
                              color: "var(--text-primary)",
                              fontWeight: 500,
                            }}
                          >
                            <DollarSign size={12} />
                            {formatItemBudget(
                              item.estimatedBudget,
                              item.currency,
                            )}
                          </div>
                        </div>
                        {item.approvedBudget != null &&
                          item.approvedBudget > 0 && (
                            <div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  color: "var(--text-tertiary)",
                                  marginBottom: "2px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.03em",
                                }}
                              >
                                Approved Budget
                              </div>
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontSize: "13px",
                                  color: "var(--success)",
                                  fontWeight: 500,
                                }}
                              >
                                <DollarSign size={12} />
                                {formatItemBudget(
                                  item.approvedBudget,
                                  item.currency,
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {/* Phase 7: Change TA / Assign TA — HR Admin only, non-terminal items */}
                      {isHRRole &&
                        item.itemStatus !== "Fulfilled" &&
                        item.itemStatus !== "Cancelled" && (
                          <button
                            className="action-button"
                            style={{
                              fontSize: "12px",
                              padding: "8px 12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                            onClick={() =>
                              setReassignModal({
                                mode: "item",
                                itemId: item.numericItemId,
                                itemLabel: `${item.skill} (Item #${item.numericItemId})`,
                                currentTAId: item.assignedTAId ?? null,
                              })
                            }
                          >
                            <ArrowRightLeft size={12} />
                            {item.assignedTAId ? "Change TA" : "Assign TA"}
                          </button>
                        )}


                      {isEditing && (
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            className="action-button"
                            style={{ fontSize: "11px", padding: "6px 10px" }}
                            onClick={() =>
                              handleItemStatusChange(item.id, "Fulfilled")
                            }
                            disabled={item.itemStatus === "Fulfilled"}
                          >
                            Mark Fulfilled
                          </button>
                          <button
                            className="action-button"
                            style={{ fontSize: "11px", padding: "6px 10px" }}
                            onClick={() =>
                              handleItemStatusChange(item.id, "Cancelled")
                            }
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* <button
                        className="action-button"
                        style={{
                          fontSize: "12px",
                          padding: "8px 12px",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                        onClick={() => toggleItemExpansion(item.id)}
                        title="View Job Description"
                      >
                        <FileText size={12} />
                        {isExpanded ? "Hide JD" : "View JD"}
                      </button> */}
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      style={{
                        marginTop: "16px",
                        paddingTop: "16px",
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      {/* Job Description */}
                      <div
                        style={{
                          padding: "16px",
                          borderRadius: "10px",
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-subtle)",
                          marginBottom: "12px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "var(--text-tertiary)",
                            marginBottom: "8px",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          Job Description
                        </div>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--text-secondary)",
                            lineHeight: 1.6,
                          }}
                        >
                          {item.description || "No description provided."}
                        </div>
                      </div>

                      {selectedItemForAssignment === item.id && (
                        <div
                          style={{
                            marginTop: "16px",
                            padding: "16px",
                            backgroundColor: "var(--bg-secondary)",
                            borderRadius: "8px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "12px",
                            }}
                          >
                            <span style={{ fontSize: "13px", fontWeight: 600 }}>
                              Candidates ({itemCandidates.length})
                            </span>
                            {canEditItemForAddCandidate(item) && (
                              <button
                                className="action-button primary"
                                style={{
                                  fontSize: "11px",
                                  padding: "4px 10px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                                onClick={() => {
                                  setAddCandidateItemId(item.numericItemId);
                                  setShowAddCandidate(true);
                                }}
                              >
                                <UserPlus size={12} /> Add Candidate
                              </button>
                            )}
                          </div>
                          {itemCandidates.length === 0 ? (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-tertiary)",
                                textAlign: "center",
                                padding: "12px",
                              }}
                            >
                              No candidates yet. Add one to start the pipeline.
                            </div>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                              }}
                            >
                              {itemCandidates.map((c) => (
                                <div
                                  key={c.candidate_id}
                                  style={{
                                    padding: "10px 12px",
                                    backgroundColor: "var(--bg-primary)",
                                    borderRadius: "8px",
                                    border: "1px solid var(--border-subtle)",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => setSelectedCandidate(c)}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontWeight: 500,
                                        fontSize: "13px",
                                      }}
                                    >
                                      {c.full_name}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "var(--text-tertiary)",
                                      }}
                                    >
                                      {c.email} • {c.interviews.length} round(s)
                                    </div>
                                  </div>
                                  <span
                                    style={{
                                      padding: "2px 8px",
                                      borderRadius: "12px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      backgroundColor:
                                        c.current_stage === "Hired"
                                          ? "rgba(16,185,129,0.1)"
                                          : c.current_stage === "Rejected"
                                            ? "rgba(239,68,68,0.1)"
                                            : "rgba(59,130,246,0.1)",
                                      color:
                                        c.current_stage === "Hired"
                                          ? "#10b981"
                                          : c.current_stage === "Rejected"
                                            ? "#ef4444"
                                            : "#3b82f6",
                                    }}
                                  >
                                    {c.current_stage}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: "32px",
              padding: "20px",
              backgroundColor: "rgba(59, 130, 246, 0.05)",
              borderRadius: "12px",
              border: "1px solid rgba(59, 130, 246, 0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "8px",
              }}
            >
              <AlertCircle size={16} color="var(--primary-accent)" />
              <strong
                style={{ fontSize: "13px", color: "var(--text-primary)" }}
              >
                Workflow Note
              </strong>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              Each requisition item represents one position. When you assign an
              employee, the item status changes to "Fulfilled". The overall
              requisition will close automatically when all items are either
              "Fulfilled" or "Cancelled".
            </p>
          </div>
        </div>
      )}

      {activeTab === "candidates" && (
        <div className="master-data-manager">
          <div
            className="data-manager-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2>Candidate Pipeline</h2>
              <p className="subtitle">
                Track and manage candidates across all positions
              </p>
            </div>
            {ticket.items.some((it) => canEditItemForAddCandidate(it)) && (
              <button
                className="action-button primary"
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
                onClick={() => {
                  const editableItem = ticket.items.find((it) =>
                    canEditItemForAddCandidate(it),
                  );
                  setAddCandidateItemId(
                    editableItem?.numericItemId ??
                      ticket.items[0]?.numericItemId ??
                      null,
                  );
                  setShowAddCandidate(true);
                }}
                disabled={!ticket.items.length}
              >
                <UserPlus size={14} /> Add Candidate
              </button>
            )}
          </div>

          {/* Filters: Item and Stage */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            {/* Item filter */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                }}
              >
                Filter by Position:
              </label>
              <select
                value={
                  candidateItemFilter === "all" ? "all" : candidateItemFilter
                }
                onChange={(e) =>
                  setCandidateItemFilter(
                    e.target.value === "all" ? "all" : Number(e.target.value),
                  )
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "12px",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  minWidth: "200px",
                }}
              >
                <option value="all">All Positions</option>
                {ticket.items.map((item) => {
                  const itemCandidateCount = candidates.filter(
                    (c) => c.requisition_item_id === item.numericItemId,
                  ).length;
                  return (
                    <option key={item.numericItemId} value={item.numericItemId}>
                      {item.skill} ({itemCandidateCount})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Stage filter tabs */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
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
                        (c) => c.requisition_item_id === candidateItemFilter,
                      );
                const count =
                  stage === "all"
                    ? filteredByItem.length
                    : filteredByItem.filter((c) => c.current_stage === stage)
                        .length;
                const isActive = candidateStageFilter === stage;
                return (
                  <button
                    key={stage}
                    onClick={() => setCandidateStageFilter(stage)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "20px",
                      fontSize: "12px",
                      fontWeight: isActive ? 600 : 400,
                      border: isActive
                        ? "2px solid var(--primary-accent)"
                        : "1px solid var(--border-subtle)",
                      backgroundColor: isActive
                        ? "rgba(59,130,246,0.08)"
                        : "transparent",
                      color: isActive
                        ? "var(--primary-accent)"
                        : "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {stage === "all" ? "All" : stage} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Candidate Form */}
          {showAddCandidate && (
            <form
              onSubmit={handleAddCandidate}
              style={{
                marginBottom: "20px",
                padding: "20px",
                borderRadius: "12px",
                backgroundColor: "rgba(59,130,246,0.04)",
                border: "1px solid rgba(59,130,246,0.15)",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "16px",
                }}
              >
                Add New Candidate
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  marginBottom: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Position *
                  </label>
                  <select
                    value={addCandidateItemId ?? ""}
                    onChange={(e) =>
                      setAddCandidateItemId(Number(e.target.value))
                    }
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "13px",
                    }}
                  >
                    {ticket.items.map((it) => (
                      <option key={it.numericItemId} value={it.numericItemId}>
                        {it.skill} — {it.level}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={newCandidateName}
                    onChange={(e) => setNewCandidateName(e.target.value)}
                    required
                    placeholder="e.g., Tejas Sharma"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "13px",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Email *
                  </label>
                  <input
                    type="email"
                    value={newCandidateEmail}
                    onChange={(e) => setNewCandidateEmail(e.target.value)}
                    required
                    placeholder="tejas@example.com"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "13px",
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  marginBottom: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={newCandidatePhone}
                    onChange={(e) => setNewCandidatePhone(e.target.value)}
                    placeholder="+91-XXXXXXXXXX"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "13px",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Resume (PDF/DOC)
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                    style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="action-button"
                  style={{ fontSize: "12px", padding: "8px 16px" }}
                  onClick={() => {
                    setShowAddCandidate(false);
                    setAddCandidateItemId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="action-button primary"
                  style={{ fontSize: "12px", padding: "8px 16px" }}
                  disabled={
                    addingCandidate ||
                    !newCandidateName.trim() ||
                    !newCandidateEmail.trim()
                  }
                >
                  {addingCandidate ? "Adding..." : "Add Candidate"}
                </button>
              </div>
            </form>
          )}

          {/* Candidate cards (Kanban-style by stage) */}
          {candidatesLoading ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
                color: "var(--text-tertiary)",
              }}
            >
              Loading candidates...
            </div>
          ) : candidates.length === 0 ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
                color: "var(--text-tertiary)",
                fontSize: "14px",
              }}
            >
              <UserPlus
                size={32}
                style={{ marginBottom: "8px", opacity: 0.4 }}
              />
              <p>
                No candidates yet. Add your first candidate to start the
                pipeline.
              </p>
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {candidates
                .filter((c) => {
                  // Item filter
                  if (
                    candidateItemFilter !== "all" &&
                    c.requisition_item_id !== candidateItemFilter
                  ) {
                    return false;
                  }
                  // Stage filter
                  if (
                    candidateStageFilter !== "all" &&
                    c.current_stage !== candidateStageFilter
                  ) {
                    return false;
                  }
                  return true;
                })
                .map((c) => {
                  const linkedItem = ticket.items.find(
                    (it) => it.numericItemId === c.requisition_item_id,
                  );
                  const stageColors: Record<
                    string,
                    { bg: string; text: string }
                  > = {
                    Sourced: { bg: "rgba(100,116,139,0.1)", text: "#64748b" },
                    Shortlisted: {
                      bg: "rgba(59,130,246,0.1)",
                      text: "#3b82f6",
                    },
                    Interviewing: {
                      bg: "rgba(168,85,247,0.1)",
                      text: "#a855f7",
                    },
                    Offered: { bg: "rgba(245,158,11,0.1)", text: "#f59e0b" },
                    Hired: { bg: "rgba(16,185,129,0.1)", text: "#10b981" },
                    Rejected: { bg: "rgba(239,68,68,0.1)", text: "#ef4444" },
                  };
                  const defaultStageColor = {
                    bg: "rgba(100,116,139,0.1)",
                    text: "#64748b",
                  };
                  const sc = stageColors[c.current_stage] ?? defaultStageColor;

                  return (
                    <div
                      key={c.candidate_id}
                      onClick={() => setSelectedCandidate(c)}
                      style={{
                        padding: "16px 20px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "12px",
                        border: "1px solid var(--border-subtle)",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "8px",
                              background:
                                "linear-gradient(135deg, var(--slate-600), var(--slate-700))",
                              color: "white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 600,
                              fontSize: "14px",
                            }}
                          >
                            {c.full_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "14px" }}>
                              {c.full_name}
                            </div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {c.email}
                              {c.phone ? ` • ${c.phone}` : ""}
                            </div>
                            {linkedItem && (
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "var(--text-tertiary)",
                                  marginTop: "2px",
                                }}
                              >
                                Position: {linkedItem.skill} —{" "}
                                {linkedItem.level}
                              </div>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            {c.interviews.length} round
                            {c.interviews.length !== 1 ? "s" : ""}
                          </span>
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: "20px",
                              fontSize: "11px",
                              fontWeight: 600,
                              backgroundColor: sc.bg,
                              color: sc.text,
                            }}
                          >
                            {c.current_stage}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Candidate Detail Modal */}
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

      {activeTab === "timeline" && (
        <div className="master-data-manager">
          <div className="data-manager-header">
            <h2>Activity Timeline</h2>
            <p className="subtitle">
              Complete history of requisition updates and assignments
            </p>
          </div>

          {timelineWithStatus.length === 0 ? (
            <div className="tickets-empty-state">No timeline activity yet.</div>
          ) : (
            <div className="milestone-timeline">
              {timelineWithStatus.map((item, idx) => {
                const statusClass = item.isCompleted
                  ? "completed"
                  : item.isCurrent
                    ? "current"
                    : "upcoming";
                const timeLabel = item.time
                  ? `${formatRelativeTime(item.time)} · ${new Date(item.time).toLocaleString("en-IN")}`
                  : item.forceCompleted
                    ? "Completed (time unavailable)"
                    : "Pending";

                return (
                  <div key={item.id} className="milestone-row">
                    <div className="milestone-track">
                      <div
                        className={`milestone-node ${statusClass}`}
                        aria-hidden
                      />
                      {idx < timelineWithStatus.length - 1 && (
                        <div
                          className={`milestone-line ${statusClass} ${
                            item.isDelayed ? "delayed" : ""
                          }`}
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className="milestone-card">
                      <div className="milestone-title">{item.title}</div>
                      <div className="milestone-meta">
                        <div className="milestone-avatar">
                          {getInitials(item.actor)}
                        </div>
                        <div className="milestone-actor">{item.actor}</div>
                        <div className="milestone-time">{timeLabel}</div>
                      </div>
                      {item.note && (
                        <div className="milestone-note">Note: {item.note}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add New Event (if editing) */}
          {isEditing && (
            <div
              style={{
                marginTop: "32px",
                paddingTop: "24px",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "12px",
                }}
              >
                Add Timeline Entry
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <input
                  type="text"
                  placeholder="Event description..."
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-subtle)",
                  }}
                />
                <button className="action-button primary">Add Entry</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notes Section */}
      <div className="master-data-manager" style={{ marginTop: "24px" }}>
        <div className="data-manager-header">
          <h2>Notes & Comments</h2>
          <p className="subtitle">Internal communication and updates</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {ticket.notes.map((note, idx) => (
            <div
              key={idx}
              style={{
                padding: "16px",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      backgroundColor: "var(--primary-accent)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                  >
                    {note.user
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{note.user}</div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {note.date}
                    </div>
                  </div>
                </div>
                {isEditing && (
                  <button
                    className="action-button"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                  >
                    Edit
                  </button>
                )}
              </div>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  lineHeight: 1.5,
                }}
              >
                {note.text}
              </p>
            </div>
          ))}

          {/* Add New Note */}
          {isEditing && (
            <div
              style={{
                padding: "20px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "12px",
                border: "2px dashed var(--border-subtle)",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "12px",
                }}
              >
                Add New Note
              </div>
              <textarea
                placeholder="Enter your note or comment here..."
                rows={3}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-primary)",
                  resize: "vertical",
                  fontSize: "14px",
                  marginBottom: "12px",
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                }}
              >
                <button
                  className="action-button"
                  style={{ fontSize: "12px", padding: "8px 16px" }}
                  onClick={() => setNewNote("")}
                >
                  Cancel
                </button>
                <button
                  className="action-button primary"
                  style={{ fontSize: "12px", padding: "8px 16px" }}
                  onClick={handleAddNote}
                >
                  Add Note
                </button>
              </div>
            </div>
          )}

          {/* Summary Stats Card */}
          <div
            style={{
              marginTop: "24px",
              padding: "20px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                  marginBottom: "4px",
                }}
              >
                Total Positions
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>
                {completionStats.totalItems}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                  marginBottom: "4px",
                }}
              >
                Fulfilled
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  color: "var(--success)",
                }}
              >
                {completionStats.fulfilled}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                  marginBottom: "4px",
                }}
              >
                Pending
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  color: "var(--warning)",
                }}
              >
                {completionStats.pending}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                  marginBottom: "4px",
                }}
              >
                Completion
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  color: "var(--primary-accent)",
                }}
              >
                {completionStats.progress}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Guidance */}
      {ticket.overallStatus !== "Fulfilled" && (
        <div
          style={{
            marginTop: "24px",
            padding: "20px",
            backgroundColor: "rgba(59, 130, 246, 0.05)",
            borderRadius: "12px",
            border: "1px solid rgba(59, 130, 246, 0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <AlertCircle size={20} color="var(--primary-accent)" />
            <div>
              <h3
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                HR Workflow Guidance
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Recommended steps to process this requisition
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "16px",
            }}
          >
            <div
              style={{
                padding: "12px",
                backgroundColor: "white",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--primary-accent)",
                    }}
                  >
                    1
                  </span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Review Open Items
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Check all pending positions in the "Requisition Items" tab
              </p>
            </div>

            <div
              style={{
                padding: "12px",
                backgroundColor: "white",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--primary-accent)",
                    }}
                  >
                    2
                  </span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Match Resources
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Use the "Candidates" tab to manage pipeline and track interviews
              </p>
            </div>

            <div
              style={{
                padding: "12px",
                backgroundColor: "white",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--primary-accent)",
                    }}
                  >
                    3
                  </span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Update Status
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Mark items as fulfilled or cancelled as you work through them
              </p>
            </div>

            <div
              style={{
                padding: "12px",
                backgroundColor: "white",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--primary-accent)",
                    }}
                  >
                    4
                  </span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Document Progress
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Add notes in the timeline section to track your progress
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons Footer */}
      <div
        style={{
          marginTop: "32px",
          padding: "20px",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "12px",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}
          >
            Requisition Status
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Current status:{" "}
            <strong
              style={{
                color:
                  ticket.overallStatus === "Open"
                    ? "#2563eb"
                    : ticket.overallStatus === "In Progress"
                      ? "#d97706"
                      : "#059669",
              }}
            >
              {ticket.overallStatus}
            </strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          {ticket.overallStatus !== "Fulfilled" && (
            <>
              {/* <button
                className="action-button"
                onClick={() => {
                  setTicket((prev) => ({ ...prev, priority: "High" }));
                }}
                style={{
                  fontSize: "12px",
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <AlertCircle size={14} />
                Mark as Urgent
              </button> */}

              <button
                className="action-button primary"
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you sure you want to mark this requisition as fulfilled? This action cannot be undone.",
                    )
                  ) {
                    setTicket((prev) =>
                      prev ? { ...prev, overallStatus: "Fulfilled" } : prev,
                    );
                  }
                }}
                style={{
                  fontSize: "12px",
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <CheckCircle size={14} />
                Mark as Fulfilled
              </button>
            </>
          )}

          {/* <button
            className="action-button"
            onClick={() => window.print()}
            style={{
              fontSize: "12px",
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Printer size={14} />
            Print Summary
          </button> */}
        </div>
      </div>

      {/* Footer - Audit Trail */}
      {/* <div
        style={{
          marginTop: "32px",
          paddingTop: "20px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "12px",
            color: "var(--text-tertiary)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Shield size={14} />
            <span>Audit Trail: All changes are logged for compliance</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Clock size={14} />
            <span>Last updated: Today, 14:30</span>
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Target size={14} />
            <span>Requisition ID: {ticket.ticketId}</span>
          </div>
        </div>
      </div> */}

      {/* Help Section */}
      {/* Phase 7: TA Reassignment Modal */}
      {reassignModal && (
        <ReassignTAModal
          mode={reassignModal.mode}
          reqId={parseReqId(effectiveTicketId) ?? 0}
          itemId={reassignModal.itemId}
          itemLabel={reassignModal.itemLabel}
          currentTAId={reassignModal.currentTAId}
          oldTAId={reassignModal.mode === "bulk" ? bulkOldTAId : undefined}
          taUsers={taUsersList}
          usersById={usersById}
          activeItemCount={
            reassignModal.mode === "bulk" && bulkOldTAId
              ? ticket.items.filter(
                  (i) =>
                    i.assignedTAId === bulkOldTAId &&
                    i.itemStatus !== "Fulfilled" &&
                    i.itemStatus !== "Cancelled",
                ).length
              : undefined
          }
          onSuccess={handleRefreshData}
          onClose={() => setReassignModal(null)}
        />
      )}

      {/* JD PDF Viewer Modal */}
      {showJdViewer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
          onClick={(e) => e.target === e.currentTarget && closeJdViewer()}
        >
          <div
            style={{
              width: "90%",
              maxWidth: "900px",
              maxHeight: "90vh",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <FileText size={20} color="var(--primary-accent)" />
                Job Description
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {jdBlobUrl && (
                  <a
                    href={jdBlobUrl}
                    download={`JD_${ticket?.ticketId ?? "requisition"}.pdf`}
                    className="action-button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      textDecoration: "none",
                    }}
                  >
                    <Download size={14} />
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={closeJdViewer}
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--bg-secondary)",
                    cursor: "pointer",
                  }}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                padding: "16px",
                overflow: "auto",
              }}
            >
              {loadingJd ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "48px",
                    color: "var(--text-tertiary)",
                    fontSize: "13px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      border: "2px solid var(--border-subtle)",
                      borderTopColor: "var(--primary-accent)",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                  <p style={{ marginTop: "16px" }}>Loading PDF...</p>
                </div>
              ) : jdBlobUrl ? (
                <iframe
                  src={jdBlobUrl}
                  title="Job Description PDF"
                  style={{
                    width: "100%",
                    height: "75vh",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "8px",
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "48px",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <FileText size={48} style={{ marginBottom: "16px" }} />
                  <p style={{ fontSize: "14px" }}>Could not load PDF.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDetail;
