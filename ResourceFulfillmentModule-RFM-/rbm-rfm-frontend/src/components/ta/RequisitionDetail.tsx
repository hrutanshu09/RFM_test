import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
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
  AlertCircle,
  Briefcase,
  MapPin,
  ChevronDown,
  ChevronUp,
  Upload,
  Ban,
  Search,
  UserCheck,
  Phone,
  Gift,
  DollarSign,
  RefreshCw,
  Eye,
} from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../contexts/useAuth";
import { AuditSection } from "../audit";
import {
  normalizeStatus,
  getStatusLabel,
  isTerminalStatus,
  RequisitionItemStatus,
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
} from "../../types/workflow";
import {
  shortlistItem,
  startInterview,
  makeOffer,
  fulfillItem,
  cancelItem as cancelItemApi,
} from "../../api/workflowApi";
import {
  fetchCandidates,
  createCandidate,
  uploadResume,
  getCandidateActionErrorMessage,
  type Candidate,
  type CandidateCreate,
} from "../../api/candidateApi";
import CandidateDetailModal from "../shared/CandidateDetailModal";
import "../../styles/hr/hr-dashboard.css";

interface RequisitionDetailsProps {
  requisitionId?: string | null;
  onBack?: () => void;
  onUpdate?: (ticket: TicketData) => void;
}

interface RequisitionItem {
  id: string;
  numericItemId: number; // Phase 7: Numeric item ID for API calls
  skill: string;
  level: string;
  experience: number;
  education: string;
  itemStatus: string;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  assignedDate?: string;
  description: string;
  cvFileUrl?: string;
  cvFileName?: string;
  assignedTAId?: number | null; // Phase 7: Item-level TA assignment
  requirements?: string;
  replacementHire?: boolean;
  replacedEmpId?: string | null;
  estimatedBudget?: number | null;
  approvedBudget?: number | null;
  currency?: string;
  jdFileKey?: string | null;
}

// Phase 4: Item status milestone order for visual tracking
const ITEM_MILESTONE_ORDER: RequisitionItemStatus[] = [
  "Pending",
  "Sourcing",
  "Shortlisted",
  "Interviewing",
  "Offered",
  "Fulfilled",
];

const getItemMilestoneIndex = (status: string): number => {
  const idx = ITEM_MILESTONE_ORDER.indexOf(status as RequisitionItemStatus);
  return idx >= 0 ? idx : 0;
};

const ITEM_STATUS_ICONS: Record<string, React.ReactNode> = {
  Pending: <Clock size={14} />,
  Sourcing: <Search size={14} />,
  Shortlisted: <FileText size={14} />,
  Interviewing: <Phone size={14} />,
  Offered: <Gift size={14} />,
  Fulfilled: <CheckCircle size={14} />,
  Cancelled: <Ban size={14} />,
};

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
  assigned_ta?: number | null; // Phase 7: Item-level TA assignment
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

const RequisitionDetail: React.FC<RequisitionDetailsProps> = ({
  requisitionId,
  onBack,
  onUpdate,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const effectiveTicketId = requisitionId ?? id;
  const getTodayDate = () =>
    new Date().toISOString().split("T")[0] ?? new Date().toISOString();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "items" | "candidates" | "timeline"
  >("overview");
  const [selectedItemForAssignment, setSelectedItemForAssignment] = useState<
    string | null
  >(null);
  const initialItemStatusesRef = useRef<Record<string, string>>({});
  const [newNote, setNewNote] = useState("");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [usersById, setUsersById] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = user?.user_id ?? null;
  const userRoles = user?.roles ?? [];
  const isHRUser = userRoles.some((r) =>
    ["hr", "admin"].includes(r.toLowerCase()),
  );

  // Phase 7: Per-item edit permission check
  // TA can edit items explicitly assigned to them OR,
  // if they are the header-level TA and the item has no item-level TA yet.
  const canEditItem = (item: RequisitionItem): boolean => {
    if (!currentUserId) return false;
    // HR/Admin can edit any item
    if (isHRUser) return true;

    const headerAssignedToMe =
      ticket?.assignedTAId != null && ticket.assignedTAId === currentUserId;

    // If item has an explicit TA, require it to match current user.
    if (item.assignedTAId != null) {
      return item.assignedTAId === currentUserId;
    }

    // Unassigned item: allow header-level TA to act as owner.
    return headerAssignedToMe;
  };

  // Legacy: Header-level check (kept for backward compatibility)
  const canAssignResources = Boolean(
    ticket?.assignedTAId &&
    currentUserId &&
    ticket.assignedTAId === currentUserId,
  );

  // Phase 4: CV Upload state
  const [cvUploading, setCvUploading] = useState<string | null>(null);
  const cvInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Phase 4: Item workflow transition state
  const [transitioningItem, setTransitioningItem] = useState<string | null>(
    null,
  );
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionSuccess, setTransitionSuccess] = useState<string | null>(
    null,
  );

  // Phase 4: HR Kill Switch - Cancel Item Modal
  const [cancelModalItem, setCancelModalItem] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // JD PDF viewer (item-level only)
  const [showJdViewer, setShowJdViewer] = useState(false);
  const [jdItemId, setJdItemId] = useState<number | null>(null);
  const [jdBlobUrl, setJdBlobUrl] = useState<string | null>(null);
  const [loadingJd, setLoadingJd] = useState(false);

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

  const parseReqId = (value?: string | null) => {
    if (!value) return null;
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
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

  /**
   * Map a requisition status to a ticket-status CSS class.
   * Normalizes legacy values via canonical types/workflow.ts.
   */
  const getOverallStatusClass = (status: string) => {
    const normalized = normalizeStatus(status);
    switch (normalized) {
      case "Draft":
      case "Pending_Budget":
      case "Pending_HR":
        return "ticket-status open";
      case "Active":
        return "ticket-status in-progress";
      case "Fulfilled":
        return "ticket-status fulfilled";
      case "Rejected":
      case "Cancelled":
        return "ticket-status closed";
      default:
        return "ticket-status";
    }
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

    const assignedTAId = req.assigned_ta ?? null;
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
      assignedTA: assignedTAId ? `User #${assignedTAId}` : "Unassigned",
      assignedTAId,
      raisedById: req.raised_by ?? null,
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
          numericItemId: item.item_id, // Phase 7: Numeric ID for API
          skill: item.role_position,
          level: item.skill_level ?? "—",
          experience: item.experience_years ?? 0,
          education: item.education_requirement ?? "—",
          itemStatus: item.item_status,
          description: item.job_description,
          assignedTAId: item.assigned_ta ?? null, // Phase 7: Item-level TA
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

  useEffect(() => {
    if (!canAssignResources && selectedItemForAssignment) {
      setSelectedItemForAssignment(null);
    }
  }, [canAssignResources, selectedItemForAssignment]);

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
          const built = buildTicket(response.data);
          setTicket(built);
          const statusMap: Record<string, string> = {};
          built.items.forEach((item) => {
            statusMap[item.id] = item.itemStatus;
          });
          initialItemStatusesRef.current = statusMap;
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

  // ---- Add candidate handler ----
  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || !addCandidateItemId) return;
    setAddingCandidate(true);
    setTransitionError(null);
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
      // Reset form
      setNewCandidateName("");
      setNewCandidateEmail("");
      setNewCandidatePhone("");
      setResumeFile(null);
      setShowAddCandidate(false);
      setAddCandidateItemId(null);
      await loadCandidates();
    } catch (err: any) {
      setTransitionError(
        getCandidateActionErrorMessage(err, "Failed to add candidate"),
      );
    } finally {
      setAddingCandidate(false);
    }
  };

  // ============================================================================
  // HOOKS THAT MUST BE CALLED BEFORE EARLY RETURNS (React Rules of Hooks)
  // ============================================================================

  // Phase 4: CV Upload Handler
  const handleCvUpload = useCallback(
    async (itemId: string, event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setCvUploading(itemId);
      setTransitionError(null);

      try {
        // Simulate CV upload - in production, this would upload to storage
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const fileUrl = `https://storage.example.com/cv/${itemId}_${file.name}`;

        // Update local state with CV info
        setTicket((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.id === itemId
                ? { ...item, cvFileUrl: fileUrl, cvFileName: file.name }
                : item,
            ),
          };
        });

        setTransitionSuccess(`CV uploaded: ${file.name}`);
        setTimeout(() => setTransitionSuccess(null), 3000);
      } catch (err) {
        setTransitionError(
          err instanceof Error ? err.message : "Failed to upload CV",
        );
      } finally {
        setCvUploading(null);
      }
    },
    [],
  );

  // Phase 4: Refresh requisition data
  const refreshRequisition = useCallback(async () => {
    const reqId = parseReqId(effectiveTicketId);
    if (!reqId) return;

    try {
      const response = await apiClient.get<BackendRequisition>(
        `/requisitions/${reqId}`,
      );
      const built = buildTicket(response.data);
      setTicket(built);
      const statusMap: Record<string, string> = {};
      built.items.forEach((item) => {
        statusMap[item.id] = item.itemStatus;
      });
      initialItemStatusesRef.current = statusMap;
    } catch {
      // Silent refresh failure
    }
  }, [effectiveTicketId]);

  // Phase 4: Item Workflow Transitions
  const handleItemTransition = useCallback(
    async (
      itemId: string,
      action: "shortlist" | "interview" | "offer" | "fulfill",
      employeeId?: string,
    ) => {
      const numericId = Number(itemId.replace("ITEM-", ""));
      if (isNaN(numericId)) {
        setTransitionError("Invalid item ID");
        return;
      }

      // Phase 7: Per-item authorization check
      const item = ticket?.items.find((i) => i.id === itemId);
      if (!item) {
        setTransitionError("Item not found");
        return;
      }

      // Phase 7: Check item-level TA permission
      if (!currentUserId) {
        setTransitionError("You must be logged in to update items.");
        return;
      }
      const isUserHRorAdmin = userRoles.some((r) =>
        ["hr", "admin"].includes(r.toLowerCase()),
      );

      const headerAssignedToMe =
        ticket?.assignedTAId != null && ticket.assignedTAId === currentUserId;
      const canUserEditItem = isUserHRorAdmin
        ? true
        : item.assignedTAId != null
          ? item.assignedTAId === currentUserId
          : headerAssignedToMe;

      if (!canUserEditItem) {
        setTransitionError(
          "You are not authorized to update this item. It is assigned to another TA.",
        );
        return;
      }

      // Phase 4: Shortlist requires CV upload
      if (action === "shortlist" && !item?.cvFileUrl) {
        setTransitionError("CV upload is mandatory before shortlisting");
        return;
      }

      setTransitioningItem(itemId);
      setTransitionError(null);
      setTransitionSuccess(null);

      try {
        switch (action) {
          case "shortlist":
            await shortlistItem(numericId);
            break;
          case "interview":
            await startInterview(numericId);
            break;
          case "offer":
            await makeOffer(numericId);
            break;
          case "fulfill":
            if (!employeeId) {
              throw new Error("Employee ID required for fulfillment");
            }
            await fulfillItem(numericId, employeeId);
            break;
        }

        setTransitionSuccess(
          `Item ${itemId} successfully moved to ${
            action === "shortlist"
              ? "Shortlisted"
              : action === "interview"
                ? "Interviewing"
                : action === "offer"
                  ? "Offered"
                  : "Fulfilled"
          }`,
        );

        // Refresh requisition data from backend
        await refreshRequisition();

        setTimeout(() => setTransitionSuccess(null), 3000);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Transition failed";
        const apiDetail =
          typeof err === "object" && err !== null && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail
            : undefined;
        setTransitionError(apiDetail ?? message);
      } finally {
        setTransitioningItem(null);
      }
    },
    [ticket, refreshRequisition, currentUserId, userRoles],
  );

  // Phase 4: HR Kill Switch - Cancel Item
  const handleCancelItem = useCallback(async () => {
    if (!cancelModalItem || !cancelReason.trim()) {
      setCancelError("Reason is required for cancellation");
      return;
    }

    if (cancelReason.trim().length < 10) {
      setCancelError("Reason must be at least 10 characters");
      return;
    }

    const numericId = Number(cancelModalItem.replace("ITEM-", ""));
    if (isNaN(numericId)) {
      setCancelError("Invalid item ID");
      return;
    }

    setCancelling(true);
    setCancelError(null);

    try {
      await cancelItemApi(numericId, cancelReason.trim());

      setTransitionSuccess(`Item ${cancelModalItem} has been cancelled`);
      setCancelModalItem(null);
      setCancelReason("");

      // Refresh requisition data from backend
      await refreshRequisition();

      setTimeout(() => setTransitionSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cancel failed";
      const apiDetail =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response
              ?.data?.detail
          : undefined;
      setCancelError(apiDetail ?? message);
    } finally {
      setCancelling(false);
    }
  }, [cancelModalItem, cancelReason, refreshRequisition]);

  // ============================================================================
  // EARLY RETURNS (after all hooks)
  // ============================================================================

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
        statusHistoryByStatus["Pending_HR"]?.changed_at ??
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

    {
      const normalized = normalizeStatus(ticket.overallStatus);
      if (
        normalized === "Fulfilled" ||
        normalized === "Cancelled" ||
        normalized === "Rejected"
      ) {
        steps.push({
          id: "fulfilled",
          title: `Requisition ${getStatusLabel(ticket.overallStatus)}`,
          actor: resolveUserName(statusHistoryByStatus[normalized]?.changed_by),
          time: statusHistoryByStatus[normalized]?.changed_at ?? null,
        });
      }
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

  const completionStats = {
    totalItems: ticket.items.length,
    fulfilled: ticket.items.filter((item) => item.itemStatus === "Fulfilled")
      .length,
    pending: ticket.items.filter((item) => item.itemStatus === "Pending")
      .length,
    cancelled: ticket.items.filter((item) => item.itemStatus === "Cancelled")
      .length,
    progress:
      ticket.items.length > 0
        ? Math.round(
            (ticket.items.filter(
              (item) =>
                item.itemStatus === "Fulfilled" ||
                item.itemStatus === "Cancelled",
            ).length /
              ticket.items.length) *
              100,
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
    // NOTE: Overall status transitions are driven by the backend workflow engine.
    // Do NOT auto-set overallStatus here — save triggers the backend to evaluate.
  };

  // Handle employee assignment
  const handleAssignEmployee = (itemId: string, employeeId: string) => {
    // Legacy stub — assignments now go through the Candidate Pipeline
  };

  // Save changes
  const handleSave = async () => {
    if (!ticket) return;
    setIsSaving(true);

    try {
      const updates = ticket.items.filter((item) => {
        const original = initialItemStatusesRef.current[item.id];
        return original && original !== item.itemStatus;
      });

      await Promise.all(
        updates.map((item) => {
          const numericId = Number(item.id.replace("ITEM-", ""));
          return apiClient.patch(`/requisitions/items/${numericId}/status`, {
            status: item.itemStatus,
          });
        }),
      );

      const reqId = parseReqId(effectiveTicketId);
      if (reqId) {
        const response = await apiClient.get<BackendRequisition>(
          `/requisitions/${reqId}`,
        );
        const built = buildTicket(response.data);
        setTicket(built);
        const statusMap: Record<string, string> = {};
        built.items.forEach((item) => {
          statusMap[item.id] = item.itemStatus;
        });
        initialItemStatusesRef.current = statusMap;

        const historyResponse = await apiClient.get<StatusHistoryEntry[]>(
          `/requisitions/${reqId}/status-history`,
        );
        setStatusHistory(historyResponse.data ?? []);
      }

      setIsEditing(false);
      if (onUpdate) {
        onUpdate(ticket);
      }
    } finally {
      setIsSaving(false);
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

  // Tabs
  const tabs = [
    {
      id: "overview" as const,
      label: "Overview",
      icon: <FileText size={16} />,
    },
    {
      id: "items" as const,
      label: "Items",
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
              Manage and update resource requirements - HR/TA View
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
                disabled={isSaving}
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Save size={16} />
                {isSaving ? "Saving..." : "Save Changes"}
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
            <span className={getOverallStatusClass(ticket.overallStatus)}>
              {getStatusLabel(ticket.overallStatus)}
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

        {/* Phase 5: Auto Closure Progress Display */}
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              Completion Progress
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Phase 5: Fractional Progress Display */}
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color:
                    completionStats.progress === 100
                      ? "var(--success)"
                      : "var(--primary-accent)",
                }}
              >
                {completionStats.fulfilled + completionStats.cancelled} /{" "}
                {completionStats.totalItems} completed
              </span>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>
                {completionStats.progress}%
              </span>
            </div>
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
                  completionStats.progress === 100
                    ? "linear-gradient(135deg, var(--success), #059669)"
                    : "linear-gradient(135deg, var(--primary-accent), var(--primary-accent-dark))",
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
            <span style={{ color: "var(--success)" }}>
              ✓ {completionStats.fulfilled} Fulfilled
            </span>
            <span style={{ color: "var(--warning)" }}>
              ○ {completionStats.pending} Pending
            </span>
            <span>✕ {completionStats.cancelled} Cancelled</span>
            <span>📊 {completionStats.totalItems} Total</span>
          </div>
          {/* Phase 5: Auto-closure indicator */}
          {completionStats.progress === 100 &&
            completionStats.pending === 0 && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  fontSize: "12px",
                  color: "var(--success)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <CheckCircle size={14} />
                <span>
                  <strong>Auto-Closure:</strong> All items are resolved.
                  Requisition will close automatically.
                </span>
              </div>
            )}
          {completionStats.pending > 0 && (
            <div
              style={{
                marginTop: "12px",
                fontSize: "11px",
                color: "var(--text-tertiary)",
              }}
            >
              Phase 5: Requisition will auto-close when all{" "}
              {completionStats.pending} pending items are fulfilled or
              cancelled.
            </div>
          )}
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
                      {/* <span style={{ color: "var(--text-secondary)" }}>
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
                    > */}
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
                        Project Manager:
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
                      <span style={{ fontWeight: 500 }}>{ticket.budget}</span>
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
                    <span style={{ fontWeight: 500 }}>
                      {ticket.assignedTAId
                        ? resolveUserName(ticket.assignedTAId)
                        : "Unassigned"}
                    </span>
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
                    <span style={{ fontWeight: 500 }}>
                      {ticket.dateCreated
                        ? new Date(ticket.dateCreated).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
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
                    SLA Status
                  </span>
                  <span
                    className={`sla-timer ${ticket.daysOpen > 10 ? "critical" : "warning"}`}
                  >
                    {ticket.slaHours - ticket.daysOpen * 24}h remaining
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
                    Match Rate
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
                    Bench Availability
                  </span>
                  <span style={{ color: "var(--success)", fontWeight: 600 }}>
                    {completionStats.pending} open positions
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="audit-log-viewer">
              <div className="viewer-header">
                <h2>Quick Actions</h2>
                <p className="subtitle">TA operations</p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  marginTop: "16px",
                }}
              >
                {/* <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => setActiveTab("employees")}
                >
                  <Users size={16} />
                  View Available Employees
                </button> */}
                {/* <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => setActiveTab("items")}
                >
                  <Briefcase size={16} />
                  Manage Requisition Items
                </button> */}
                <button
                  className="action-button"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                >
                  <MessageSquare size={16} />
                  Add Internal Note
                </button>
                {/* <button
                  className="action-button primary"
                  style={{ justifyContent: "center" }}
                >
                  <ExternalLink size={16} />
                  Generate Onboarding Plan
                </button> */}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "items" && (
        <div className="master-data-manager">
          <div className="data-manager-header">
            <h2>Requisition Items Management</h2>
            <p className="subtitle">
              Phase 4: TA Execution - Track milestones, upload CVs, and manage
              positions
            </p>
          </div>

          {/* Phase 4: Status Messages */}
          {transitionError && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "var(--error)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertCircle size={16} />
              {transitionError}
              <button
                onClick={() => setTransitionError(null)}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  color: "var(--error)",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          )}

          {transitionSuccess && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                color: "var(--success)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircle size={16} />
              {transitionSuccess}
            </div>
          )}

          {!canAssignResources && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.2)",
                color: "var(--warning)",
                fontSize: "13px",
              }}
            >
              {ticket?.assignedTAId
                ? "Assignment locked. This requisition is assigned to another TA."
                : "Assignment locked. HR must assign a TA before resources can be assigned."}
            </div>
          )}

          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {ticket.items.map((item) => {
              const primarySkill =
                parsePrimarySkill(item.requirements) ?? item.skill;
              const secondarySkills = parseSecondarySkills(item.requirements);
              const effectiveAssignedTAId =
                item.assignedTAId ?? ticket.assignedTAId ?? null;
              const assignedTALabel = effectiveAssignedTAId
                ? resolveUserName(effectiveAssignedTAId)
                : "Unassigned";
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
                  {/* Phase 4: Item Header with Status and Info */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      marginBottom: "16px",
                    }}
                  >
                    <div style={{ flex: 1 }}>
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
                                : item.itemStatus === "Cancelled"
                                  ? "ticket-status closed"
                                  : "ticket-status in-progress"
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {ITEM_STATUS_ICONS[item.itemStatus]}
                          {ITEM_STATUS_LABELS[
                            item.itemStatus as RequisitionItemStatus
                          ] ?? item.itemStatus}
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
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              marginLeft: "auto",
                            }}
                          >
                            <button
                              type="button"
                              className="action-button"
                              style={{
                                fontSize: "11px",
                                padding: "4px 8px",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              onClick={() =>
                                openJdViewerForItem(item.numericItemId)
                              }
                            >
                              <Eye size={12} />
                              View JD
                            </button>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                apiClient
                                  .get(
                                    `/requisitions/items/${item.numericItemId}/jd`,
                                    { responseType: "blob" },
                                  )
                                  .then((res) => {
                                    const url = URL.createObjectURL(
                                      res.data as Blob,
                                    );
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `JD_${item.skill}_${item.numericItemId}.pdf`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  })
                                  .catch(() => {});
                              }}
                              className="action-button"
                              style={{
                                fontSize: "11px",
                                padding: "4px 8px",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                textDecoration: "none",
                                color: "inherit",
                              }}
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
                            "repeat(auto-fill, minmax(160px, 1fr))",
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
                            Assigned TA
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: effectiveAssignedTAId
                                ? "var(--text-primary)"
                                : "var(--text-tertiary)",
                              fontWeight: 500,
                            }}
                          >
                            {assignedTALabel}
                          </div>
                        </div>
                        {item.cvFileName && (
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
                              CV Uploaded
                            </div>
                            <div
                              style={{
                                fontSize: "13px",
                                color: "var(--success)",
                                fontWeight: 500,
                              }}
                            >
                              {item.cvFileName}
                            </div>
                          </div>
                        )}
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

                    {/* Phase 4: Action Buttons */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      {/* Workflow Transition Buttons based on current status (post-sourcing stages only) */}

                      {item.itemStatus === "Shortlisted" &&
                        canEditItem(item) && (
                          <button
                            className="action-button primary"
                            style={{
                              fontSize: "12px",
                              padding: "8px 12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                            disabled={transitioningItem === item.id}
                            onClick={() =>
                              handleItemTransition(item.id, "interview")
                            }
                          >
                            <Phone size={12} />
                            {transitioningItem === item.id
                              ? "Processing..."
                              : "Schedule Interview"}
                          </button>
                        )}

                      {item.itemStatus === "Interviewing" &&
                        canEditItem(item) && (
                          <button
                            className="action-button primary"
                            style={{
                              fontSize: "12px",
                              padding: "8px 12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                            disabled={transitioningItem === item.id}
                            onClick={() =>
                              handleItemTransition(item.id, "offer")
                            }
                          >
                            <Gift size={12} />
                            {transitioningItem === item.id
                              ? "Processing..."
                              : "Extend Offer"}
                          </button>
                        )}

                      {item.itemStatus === "Pending" && canEditItem(item) && (
                        <button
                          className="action-button primary"
                          style={{
                            fontSize: "12px",
                            padding: "8px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                          onClick={() =>
                            setSelectedItemForAssignment(
                              selectedItemForAssignment === item.id
                                ? null
                                : item.id,
                            )
                          }
                        >
                          <UserPlus size={12} />
                          {selectedItemForAssignment === item.id
                            ? "Cancel"
                            : "Start Sourcing"}
                        </button>
                      )}

                      {/* Phase 4: HR Kill Switch - Only HR can cancel items */}
                      {isHRUser &&
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
                              backgroundColor: "rgba(239, 68, 68, 0.1)",
                              color: "var(--error)",
                              border: "1px solid rgba(239, 68, 68, 0.2)",
                            }}
                            onClick={() => setCancelModalItem(item.id)}
                            title="HR Kill Switch: Cancel this item"
                          >
                            <Ban size={12} />
                            Cancel Item
                          </button>
                        )}
                    </div>
                  </div>

                  {selectedItemForAssignment === item.id &&
                    canEditItem(item) && (
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
                              <span
                                style={{ fontSize: "13px", fontWeight: 600 }}
                              >
                                Candidates ({itemCandidates.length})
                              </span>
                              {canEditItem(item) && (
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
                                No candidates yet. Add one to start the
                                pipeline.
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
                                        {c.email} • {c.interviews.length}{" "}
                                        round(s)
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

                      {/* Item Audit History - Compact timeline */}
                      <div style={{ marginTop: "16px" }}>
                        <AuditSection
                          entityType="requisition-item"
                          entityId={Number(item.id.replace("ITEM-", ""))}
                          title="Item Audit Trail"
                          compact
                          maxHeight={200}
                          relativeTime
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Phase 4: Workflow Guidance */}
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
                marginBottom: "12px",
              }}
            >
              <AlertCircle size={16} color="var(--primary-accent)" />
              <strong
                style={{ fontSize: "13px", color: "var(--text-primary)" }}
              >
                Phase 4: TA Execution Workflow
              </strong>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong>1. Sourcing:</strong> Upload CV (mandatory) → Shortlist
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong>2. Shortlisted:</strong> Schedule Interview
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong>3. Interviewing:</strong> Extend Offer or Reject
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong>4. Offered:</strong> Mark Fulfilled with employee ID
              </div>
            </div>
            <p
              style={{
                marginTop: "12px",
                fontSize: "11px",
                color: "var(--text-tertiary)",
              }}
            >
              Note: HR can cancel any item using the Kill Switch (requires
              reason). Auto-closure happens when all items are Fulfilled or
              Cancelled.
            </p>
          </div>

          {/* Phase 4: HR Kill Switch Modal */}
          {cancelModalItem && (
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
              onClick={() => {
                setCancelModalItem(null);
                setCancelReason("");
                setCancelError(null);
              }}
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "20px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      backgroundColor: "rgba(239, 68, 68, 0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ban size={20} color="var(--error)" />
                  </div>
                  <div>
                    <h3
                      style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}
                    >
                      Cancel Item - HR Kill Switch
                    </h3>
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--text-tertiary)",
                        margin: 0,
                      }}
                    >
                      {cancelModalItem}
                    </p>
                  </div>
                </div>

                {cancelError && (
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      color: "var(--error)",
                      fontSize: "12px",
                    }}
                  >
                    {cancelError}
                  </div>
                )}

                <div style={{ marginBottom: "20px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 500,
                      marginBottom: "8px",
                    }}
                  >
                    Cancellation Reason{" "}
                    <span style={{ color: "var(--error)" }}>*</span>
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Enter reason for cancellation (minimum 10 characters)..."
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "8px",
                      border: `1px solid ${
                        cancelError && !cancelReason.trim()
                          ? "var(--error)"
                          : "var(--border-subtle)"
                      }`,
                      fontSize: "13px",
                      resize: "vertical",
                    }}
                  />
                  <p
                    style={{
                      fontSize: "11px",
                      color:
                        cancelReason.length < 10
                          ? "var(--text-tertiary)"
                          : "var(--success)",
                      marginTop: "4px",
                    }}
                  >
                    {cancelReason.length}/10 characters minimum
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    className="action-button"
                    onClick={() => {
                      setCancelModalItem(null);
                      setCancelReason("");
                      setCancelError(null);
                    }}
                    disabled={cancelling}
                  >
                    Keep Item
                  </button>
                  <button
                    className="action-button"
                    style={{
                      backgroundColor: "var(--error)",
                      color: "white",
                      border: "none",
                    }}
                    onClick={handleCancelItem}
                    disabled={cancelling || cancelReason.trim().length < 10}
                  >
                    {cancelling ? "Cancelling..." : "Confirm Cancellation"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
            {ticket.items.some((it) => canEditItem(it)) && (
              <button
                className="action-button primary"
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
                onClick={() => {
                  const editableItem = ticket.items.find((it) =>
                    canEditItem(it),
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
                    placeholder="e.g., Tejas Patil"
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
                  const sc =
                    stageColors[c.current_stage] ?? stageColors["Sourced"]!;

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
          userRoles={userRoles}
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
                  ? item.isDelayed
                    ? "milestone-node error"
                    : "milestone-node completed"
                  : item.isCurrent
                    ? "milestone-node current"
                    : "milestone-node upcoming";
                const timeLabel = item.time
                  ? formatRelativeTime(item.time)
                  : item.isUpcoming
                    ? "Upcoming"
                    : "Pending";
                return (
                  <div key={item.id} className="milestone-row">
                    <div className="milestone-track">
                      <div className={`milestone-node ${statusClass}`}>
                        {item.isCompleted ? <CheckCircle size={14} /> : idx + 1}
                      </div>
                      {idx < timelineWithStatus.length - 1 && (
                        <div
                          className={`milestone-line ${statusClass} ${item.isCurrent ? "active" : ""}`}
                        />
                      )}
                    </div>
                    <div className="milestone-card">
                      <div className="milestone-title">{item.title}</div>
                      <div className="milestone-meta">
                        <div className="milestone-avatar">
                          {item.actor
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase())
                            .join("")}
                        </div>
                        <div>
                          <div className="milestone-actor">{item.actor}</div>
                          <div className="milestone-time">{timeLabel}</div>
                        </div>
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

          {/* Workflow Audit History - Lazy loaded collapsible section */}
          {parseReqId(effectiveTicketId) && (
            <div style={{ marginTop: "24px" }}>
              <AuditSection
                entityType="requisition"
                entityId={parseReqId(effectiveTicketId)!}
                title="Workflow Audit History"
                relativeTime
              />
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
      {!isTerminalStatus(normalizeStatus(ticket.overallStatus)) && (
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
                TA Workflow Guidance
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Recommended steps to source and fulfill this requisition
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
                  Review Requirements
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Review job descriptions, skills, and experience requirements for each position in the "Requisition Items" tab
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
                  Source Candidates
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Add candidates to items and move them through the pipeline: Sourcing → Shortlisted → Interviewing → Offered
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
                  Manage Interviews
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Schedule interviews, track feedback, and coordinate with hiring managers through the candidate pipeline
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
                  Fulfill Positions
                </span>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                Once an offer is accepted, mark the item as "Fulfilled" and assign the selected employee to complete the requisition
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
            <strong>{getStatusLabel(ticket.overallStatus)}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          {/* NOTE: Status transitions (e.g. Mark as Fulfilled) are handled
             via WorkflowTransitionButtons which call the backend workflow
             engine. Client-side-only mutations have been removed. */}

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
      <div
        style={{
          marginTop: "32px",
          paddingTop: "20px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* <div
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
        </div> */}

        {/* <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Target size={14} />
            <span>Requisition ID: {ticket.ticketId}</span>
          </div>
        </div> */}
      </div>

      {/* Help Section */}
      <div
      // style={{
      //   marginTop: "16px",
      //   padding: "12px",
      //   backgroundColor: "var(--bg-secondary)",
      //   borderRadius: "8px",
      //   border: "1px solid var(--border-subtle)",
      //   fontSize: "11px",
      //   color: "var(--text-tertiary)",
      //   textAlign: "center",
      // }}
      >
        <strong></strong>
      </div>

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
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
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

export default RequisitionDetail;
