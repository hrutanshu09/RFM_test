import React, { useEffect, useState, useCallback } from "react";
import {
  Filter,
  Search,
  AlertCircle,
  CheckCircle,
  Users,
  Clock,
  Target,
  Briefcase,
  BarChart3,
  ChevronRight,
  UserPlus,
  Loader2,
} from "lucide-react";
import { apiClient } from "../../api/client";
import { assignRequisitionTA } from "../../api/workflowApi";
import { useAuth } from "../../contexts/useAuth";
import { normalizeStatus, getStatusLabel } from "../../types/workflow";

/* ======================================================
   Types
   ====================================================== */

interface Requisition {
  reqId: number;
  id: string;
  project: string;
  client?: string;
  priority: string;
  requiredBy: string;
  overallStatus: string;
  dateCreated: string;
  raisedBy?: string;
  assignedTA?: string;
  assignedTAId?: number | null;
  items: RequisitionItem[];
  workMode?: "Remote" | "Hybrid" | "WFO";
  location?: string;
  justification?: string;
}

interface RequisitionItem {
  id: string;
  requisitionId: string;
  skill: string;
  level: string;
  education: string;
  itemStatus: string;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  assignedDate?: string;
  description?: string;
  assignedTAId?: number | null;  // Phase 7: Item-level TA assignment
}

interface BackendRequisitionItem {
  item_id: number;
  req_id: number;
  role_position: string;
  skill_level?: string | null;
  education_requirement?: string | null;
  job_description: string;
  requirements?: string | null;
  item_status: string;
  assigned_ta?: number | null;  // Phase 7: Item-level TA assignment
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
  raised_by?: number | null;
  assigned_ta?: number | null;
  items: BackendRequisitionItem[];
}

/* ======================================================
   Data helpers
   ====================================================== */

const mapRequisitions = (data: BackendRequisition[]): Requisition[] =>
  data.map((req) => ({
    reqId: req.req_id,
    id: `REQ-${req.req_id}`,
    project: req.project_name ?? "—",
    client: req.client_name ?? "—",
    priority: req.priority ?? "—",
    requiredBy: req.required_by_date ?? "",
    overallStatus: req.overall_status ?? "—",
    dateCreated: req.created_at ?? "",
    raisedBy: req.raised_by ? `User #${req.raised_by}` : "—",
    assignedTAId: req.assigned_ta ?? null,
    assignedTA: req.assigned_ta ? `User #${req.assigned_ta}` : undefined,
    workMode: (req.work_mode as Requisition["workMode"]) ?? undefined,
    location: req.office_location ?? undefined,
    justification: req.justification ?? undefined,
    items:
      req.items?.map((item) => ({
        id: `ITEM-${item.item_id}`,
        requisitionId: `REQ-${item.req_id}`,
        skill: item.role_position,
        level: item.skill_level ?? "—",
        education: item.education_requirement ?? "—",
        itemStatus: item.item_status,
        description: item.job_description,
        assignedTAId: item.assigned_ta ?? null,  // Phase 7: Item-level TA
      })) ?? [],
  }));

/* ======================================================
   Props
   ====================================================== */

interface RequisitionsProps {
  currentTA?: string;
  onViewRequisition?: (reqId: string) => void;
  onSelfAssign?: (reqId: string) => void;
  onManageItems?: (reqId: string) => void;
  onAssignToOther?: (reqId: string, taName: string) => void;
}

/* ======================================================
   Helpers
   ====================================================== */

const getAgingClass = (days: number) => {
  if (days > 30) return "aging-30-plus";
  if (days > 7) return "aging-8-30";
  return "aging-0-7";
};

const getStatusClass = (status: Requisition["overallStatus"]) => {
  const normalized = normalizeStatus(status);
  switch (normalized) {
    case "Draft":
      return "open";
    case "Pending_Budget":
    case "Pending_HR":
    case "Active":
      return "in-progress";
    case "Fulfilled":
      return "fulfilled";
    case "Cancelled":
    case "Rejected":
      return "closed";
    default:
      return "";
  }
};

const getPriorityClass = (priority: Requisition["priority"]) => {
  switch (priority) {
    case "High":
      return "priority-high";
    case "Medium":
      return "priority-medium";
    case "Low":
      return "priority-low";
    default:
      return "";
  }
};

const calculateAgingDays = (dateString: string) => {
  const created = new Date(dateString);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - created.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const calculateCompletion = (items: RequisitionItem[]) => {
  const total = items.length;
  const fulfilled = items.filter(
    (item) => item.itemStatus === "Fulfilled",
  ).length;
  const cancelled = items.filter(
    (item) => item.itemStatus === "Cancelled",
  ).length;
  const pending = total - fulfilled - cancelled;

  return {
    total,
    fulfilled,
    cancelled,
    pending,
    progress:
      total > 0 ? Math.round(((fulfilled + cancelled) / total) * 100) : 0,
  };
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/* ======================================================
   Component: TAKpiCards
   ====================================================== */

const TAKpiCards: React.FC<{
  requisitions: Requisition[];
  currentTA: string;
}> = ({ requisitions, currentTA }) => {
  const currentUserId = useAuth().user?.user_id ?? null;
  const stats = {
    totalAssigned: requisitions.filter((r) => r.assignedTAId === currentUserId)
      .length,
    unassigned: requisitions.filter((r) => !r.assignedTAId).length,
    pendingItems: requisitions.reduce(
      (sum, req) =>
        sum + req.items.filter((item) => item.itemStatus === "Pending").length,
      0,
    ),
    highPriority: requisitions.filter(
      (r) => r.priority === "High" && r.assignedTAId === currentUserId,
    ).length,
    avgCompletion: Math.round(
      requisitions
        .filter((r) => r.assignedTAId === currentUserId)
        .reduce(
          (sum, req) => sum + calculateCompletion(req.items).progress,
          0,
        ) /
        Math.max(
          requisitions.filter((r) => r.assignedTAId === currentUserId).length,
          1,
        ),
    ),
    overdue: requisitions.filter(
      (r) =>
        calculateAgingDays(r.dateCreated) > 30 &&
        r.assignedTAId === currentUserId,
    ).length,
  };

  return (
    <div className="tickets-kpi-grid">
      <div className="ticket-kpi-card success">
        <div className="kpi-number">{stats.totalAssigned}</div>
        <div className="kpi-label">
          <Briefcase size={12} />
          My Assignments
        </div>
        <div className="kpi-trend positive">
          {stats.avgCompletion}% average completion
        </div>
      </div>

      <div className="ticket-kpi-card warning">
        <div className="kpi-number">{stats.unassigned}</div>
        <div className="kpi-label">
          <AlertCircle size={12} />
          Unassigned Tickets
        </div>
        <div className="kpi-trend">Available for pickup</div>
      </div>

      <div className="ticket-kpi-card critical">
        <div className="kpi-number">{stats.pendingItems}</div>
        <div className="kpi-label">
          <Users size={12} />
          Pending Positions
        </div>
        <div className="kpi-trend negative">
          Across{" "}
          {requisitions.filter((r) => r.assignedTAId === currentUserId).length}{" "}
          requisitions
        </div>
      </div>

      <div className="ticket-kpi-card neutral">
        <div className="kpi-number">{stats.overdue}</div>
        <div className="kpi-label">
          <Clock size={12} />
          Overdue Tickets
        </div>
        <div className="kpi-trend">
          {stats.overdue > 0 ? "Needs attention" : "All good"}
        </div>
      </div>
    </div>
  );
};

/* ======================================================
   Component: QuickAssignmentPanel
   ====================================================== */

interface QuickAssignmentPanelProps {
  requisition: Requisition;
  onAssign: (reqId: string, taName: string) => void;
  availableTAs: string[];
}

const QuickAssignmentPanel: React.FC<QuickAssignmentPanelProps> = ({
  requisition,
  onAssign,
  availableTAs,
}) => {
  const [selectedTA, setSelectedTA] = useState<string>("");

  return (
    <div
      style={{
        padding: "20px",
        backgroundColor: "var(--bg-primary)",
        borderRadius: "12px",
        border: "1px solid var(--border-subtle)",
        marginBottom: "16px",
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
        <UserPlus size={16} color="var(--primary-accent)" />
        <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
          Quick Assignment
        </strong>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "12px",
          alignItems: "end",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            Assign to TA
          </div>
          <select
            value={selectedTA}
            onChange={(e) => setSelectedTA(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-tertiary)",
              fontSize: "13px",
            }}
          >
            <option value="">Select TA...</option>
            {availableTAs.map((ta) => (
              <option key={ta} value={ta}>
                {ta}
              </option>
            ))}
          </select>
        </div>

        <button
          className="action-button primary"
          onClick={() => {
            if (selectedTA) {
              onAssign(requisition.id, selectedTA);
              setSelectedTA("");
            }
          }}
          disabled={!selectedTA}
          style={{ padding: "10px 20px" }}
        >
          Assign
        </button>
      </div>
    </div>
  );
};

/* ======================================================
   Main Component
   ====================================================== */

const Requisitions: React.FC<RequisitionsProps> = ({
  currentTA = "Rahul Mehta",
  onViewRequisition,
  onSelfAssign,
  onManageItems,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? null;
  const currentTaLabel = user?.username ?? currentTA;
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<
    "all" | "my" | "unassigned" | "high" | "overdue"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assigningReqId, setAssigningReqId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const fetchRequisitions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Phase 7: Add cache-busting to ensure fresh data after reassignment
      const baseEndpoint =
        activeFilter === "my"
          ? "/requisitions?my_assignments=true"
          : "/requisitions";
      const separator = baseEndpoint.includes("?") ? "&" : "?";
      const endpoint = `${baseEndpoint}${separator}_t=${Date.now()}`;
      const response = await apiClient.get<BackendRequisition[]>(endpoint);
      setRequisitions(mapRequisitions(response.data));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load requisitions";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    fetchRequisitions();

    const handleFocus = () => {
      fetchRequisitions();
    };
    
    // Phase 7: Listen for TA reassignment events to refresh the list
    const handleReassignment = () => {
      fetchRequisitions();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("requisition-reassigned", handleReassignment);
    const intervalId = window.setInterval(fetchRequisitions, 30000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("requisition-reassigned", handleReassignment);
      window.clearInterval(intervalId);
    };
  }, [fetchRequisitions]);

  // PHASE 3: TA users can see ALL APPROVED requisitions (Active status)
  // These are requisitions that have passed budget and HR approval
  // Unassigned items are viewable but not editable
  const visibleRequisitions = requisitions.filter((req) => {
    const status = normalizeStatus(req.overallStatus);
    // Show Active requisitions (post-HR approval)
    // Active = APPROVED_UNASSIGNED in the spec terminology
    return status === "Active";
  });

  // Filter requisitions
  const filteredRequisitions = visibleRequisitions.filter((req) => {
    // Status filter
    if (activeFilter === "my" && req.assignedTAId !== currentUserId)
      return false;
    if (activeFilter === "unassigned" && req.assignedTAId) return false;
    if (activeFilter === "high" && req.priority !== "High") return false;
    if (activeFilter === "overdue" && calculateAgingDays(req.dateCreated) <= 30)
      return false;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        req.id.toLowerCase().includes(query) ||
        req.project.toLowerCase().includes(query) ||
        req.client?.toLowerCase().includes(query) ||
        req.raisedBy?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  /**
   * Self-assign a requisition to the current TA user.
   * Calls the backend API and updates local state on success.
   */
  const handleSelfAssign = useCallback(
    async (reqId: string) => {
      if (!currentUserId) {
        setAssignError("User not authenticated");
        return;
      }

      // Extract numeric ID from "REQ-123" format
      const numericId = parseInt(reqId.replace("REQ-", ""), 10);
      if (isNaN(numericId)) {
        setAssignError("Invalid requisition ID");
        return;
      }

      setAssigningReqId(reqId);
      setAssignError(null);

      try {
        await assignRequisitionTA(numericId, currentUserId);

        // Update local state
        setRequisitions((prev) =>
          prev.map((req) =>
            req.id === reqId
              ? {
                  ...req,
                  assignedTAId: currentUserId,
                  assignedTA: currentTaLabel,
                }
              : req,
          ),
        );

        // Notify parent
        onSelfAssign?.(reqId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to assign requisition";
        const apiMessage =
          typeof err === "object" &&
          err !== null &&
          "response" in err &&
          (err as { response?: { data?: { detail?: string } } }).response?.data
            ?.detail
            ? (err as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail
            : null;
        setAssignError(apiMessage ?? message);
      } finally {
        setAssigningReqId(null);
      }
    },
    [currentUserId, currentTaLabel, onSelfAssign],
  );

  // Calculate stats for current TA
  const myRequisitions = visibleRequisitions.filter(
    (r) => r.assignedTAId === currentUserId,
  );
  const myStats = {
    total: myRequisitions.length,
    pendingPositions: myRequisitions.reduce(
      (sum, req) =>
        sum + req.items.filter((item) => item.itemStatus === "Pending").length,
      0,
    ),
    completionRate:
      myRequisitions.length > 0
        ? Math.round(
            myRequisitions.reduce(
              (sum, req) => sum + calculateCompletion(req.items).progress,
              0,
            ) / myRequisitions.length,
          )
        : 0,
    overdue: myRequisitions.filter(
      (r) => calculateAgingDays(r.dateCreated) > 30,
    ).length,
  };

  return (
    <>
      {/* Header */}
      <div className="manager-header">
        <h2>Talent Acquisition Dashboard</h2>
        <p className="subtitle">
          Manage assigned requisitions and fulfill positions item by item
        </p>
      </div>

      {/* KPI Stats */}
      <TAKpiCards requisitions={visibleRequisitions} currentTA={currentTA} />

      {/* Personal Stats */}
      {myRequisitions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                marginBottom: "4px",
              }}
            >
              Your Assignments
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700 }}>
              {myStats.total}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {myStats.pendingPositions} positions pending
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                marginBottom: "4px",
              }}
            >
              Completion Rate
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--success)",
              }}
            >
              {myStats.completionRate}%
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Average across your tickets
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                marginBottom: "4px",
              }}
            >
              Pending Positions
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--warning)",
              }}
            >
              {myStats.pendingPositions}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Across {myStats.total} requisitions
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                marginBottom: "4px",
              }}
            >
              Overdue
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: myStats.overdue > 0 ? "var(--error)" : "var(--success)",
              }}
            >
              {myStats.overdue}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Requiring immediate attention
            </div>
          </div>
        </div>
      )}

      {/* Assignment Error */}
      {assignError && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "rgba(239, 68, 68, 0.08)",
            color: "var(--error)",
            fontSize: "13px",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={16} />
          {assignError}
          <button
            onClick={() => setAssignError(null)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--error)",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Filter Chips */}
      <div className="filter-chips" style={{ marginBottom: "20px" }}>
        <button
          className={`filter-chip ${activeFilter === "all" ? "active" : ""}`}
          onClick={() => setActiveFilter("all")}
        >
          <Filter size={12} />
          All Requisitions ({requisitions.length})
        </button>
        <button
          className={`filter-chip ${activeFilter === "my" ? "active" : ""}`}
          onClick={() => setActiveFilter("my")}
        >
          <Briefcase size={12} />
          My Assignments (
          {requisitions.filter((r) => r.assignedTAId === currentUserId).length})
        </button>
        <button
          className={`filter-chip ${activeFilter === "unassigned" ? "active" : ""}`}
          onClick={() => setActiveFilter("unassigned")}
        >
          <UserPlus size={12} />
          Unassigned ({requisitions.filter((r) => !r.assignedTAId).length})
        </button>
        <button
          className={`filter-chip ${activeFilter === "high" ? "active" : ""}`}
          onClick={() => setActiveFilter("high")}
        >
          <Target size={12} />
          High Priority (
          {requisitions.filter((r) => r.priority === "High").length})
        </button>
        <button
          className={`filter-chip ${activeFilter === "overdue" ? "active" : ""}`}
          onClick={() => setActiveFilter("overdue")}
        >
          <Clock size={12} />
          Overdue (
          {
            requisitions.filter((r) => calculateAgingDays(r.dateCreated) > 30)
              .length
          }
          )
        </button>
      </div>

      {/* Search and Filters */}
      <div className="log-filters" style={{ marginBottom: "24px" }}>
        <div className="filter-group">
          <div className="search-box">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search requisitions by ID, project, or client..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="filter-grid">
          <div className="filter-item">
            <label>Priority</label>
            <select>
              <option>All Priorities</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>
          <div className="filter-item">
            <label>Status</label>
            <select>
              <option>All Status</option>
              <option>Open</option>
              <option>In Progress</option>
              <option>Fulfilled</option>
              <option>Cancelled</option>
            </select>
          </div>
          <div className="filter-item">
            <label>Location</label>
            <select>
              <option>All Locations</option>
              <option>Bengaluru</option>
              <option>Mumbai</option>
              <option>Delhi</option>
              <option>Pune</option>
            </select>
          </div>
          <div className="filter-item">
            <label>Work Mode</label>
            <select>
              <option>All Modes</option>
              <option>Remote</option>
              <option>Hybrid</option>
              <option>WFO</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="ticket-table-container">
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Req ID</th>
              <th>Project & Client</th>
              <th>Positions</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Raised By</th>
              <th>Aging</th>
              <th>Assigned TA</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9}>
                  <div className="tickets-empty-state">
                    Loading requisitions…
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <tr>
                <td colSpan={9}>
                  <div
                    className="tickets-empty-state"
                    style={{ color: "var(--error)" }}
                  >
                    {error}
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !error &&
              filteredRequisitions.map((req) => {
                const agingDays = calculateAgingDays(req.dateCreated);
                const completion = calculateCompletion(req.items);
                
                // Phase 7: Check item-level TA assignments (not just header-level)
                const activeItems = req.items.filter(
                  (item) => item.itemStatus !== "Fulfilled" && item.itemStatus !== "Cancelled"
                );
                const assignedTAs = activeItems
                  .map((item) => item.assignedTAId)
                  .filter((taId): taId is number => taId !== null && taId !== undefined);
                
                // Check if current user is assigned to ANY item
                const isAssignedToMe = assignedTAs.includes(currentUserId ?? -1);
                
                // Determine the primary TA label
                // Phase 7: Prioritize item-level assignments (they're more accurate after reassignment)
                let assignedLabel: string = "Unassigned";
                let primaryTAId: number | null = null;
                
                if (assignedTAs.length > 0) {
                  // Use item-level: find most common TA
                  const taCounts: Record<number, number> = {};
                  assignedTAs.forEach((taId) => {
                    taCounts[taId] = (taCounts[taId] ?? 0) + 1;
                  });
                  const sortedTAs = Object.entries(taCounts).sort((a, b) => b[1] - a[1]);
                  
                  // TypeScript safety: sortedTAs will have at least one entry if assignedTAs.length > 0
                  // We know assignedTAs.length > 0, so taCounts has entries, so sortedTAs[0] exists
                  if (sortedTAs.length > 0 && sortedTAs[0]) {
                    const topTA = sortedTAs[0];
                    primaryTAId = Number(topTA[0]);
                    
                    if (sortedTAs.length > 1) {
                      // Multiple different TAs assigned
                      assignedLabel = `Multiple TAs (${sortedTAs.length})`;
                    } else {
                      assignedLabel = `User #${primaryTAId}`;
                    }
                  }
                  // If sortedTAs is empty (shouldn't happen), assignedLabel stays "Unassigned"
                } else if (req.assignedTAId) {
                  // Fallback to header-level if no item-level assignments
                  primaryTAId = req.assignedTAId;
                  assignedLabel = req.assignedTA ?? `User #${req.assignedTAId}`;
                }
                // If neither condition is met, both stay at initial values
                
                const isUnassigned = !primaryTAId && assignedTAs.length === 0;

                return (
                  <React.Fragment key={req.id}>
                    <tr>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <strong>{req.id}</strong>
                          {isAssignedToMe && (
                            <div
                              style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                backgroundColor: "var(--success)",
                              }}
                            />
                          )}
                        </div>
                      </td>

                      <td>
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <strong style={{ fontSize: "14px" }}>
                            {req.project}
                          </strong>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              marginTop: "4px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "12px",
                                color: "var(--text-tertiary)",
                              }}
                            >
                              {req.client || "Internal"}
                            </span>
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--text-quaternary)",
                              }}
                            >
                              • {req.workMode || "Hybrid"} • {req.location}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <div
                              style={{
                                width: "60px",
                                height: "4px",
                                backgroundColor: "var(--border-subtle)",
                                borderRadius: "2px",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${completion.progress}%`,
                                  height: "100%",
                                  backgroundColor:
                                    completion.progress === 100
                                      ? "var(--success)"
                                      : "var(--primary-accent)",
                                  transition: "width 0.3s ease",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: "12px",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {completion.pending} pending
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            {completion.fulfilled}/{completion.total} filled
                          </div>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`priority-indicator ${getPriorityClass(req.priority)}`}
                        >
                          {req.priority}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`ticket-status ${getStatusClass(req.overallStatus)}`}
                        >
                          {getStatusLabel(req.overallStatus)}
                        </span>
                      </td>

                      <td>
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <span style={{ fontSize: "13px" }}>
                            {req.raisedBy}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            {formatDate(req.dateCreated)}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`aging-indicator ${getAgingClass(agingDays)}`}
                        >
                          {agingDays}d
                        </span>
                      </td>

                      <td>
                        {(() => {
                          const hasAssignment = (primaryTAId !== null && primaryTAId !== undefined) || assignedTAs.length > 0;
                          return hasAssignment ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <div
                                style={{
                                  width: "8px",
                                  height: "8px",
                                  borderRadius: "50%",
                                  backgroundColor: isAssignedToMe
                                    ? "var(--success)"
                                    : "var(--warning)",
                                }}
                              />
                              <span style={{ fontSize: "13px" }}>
                                {isAssignedToMe
                                  ? assignedLabel
                                  : `Managed by ${assignedLabel}`}
                              </span>
                            </div>
                          ) : (
                            <span className="status-badge inactive">
                              Unassigned
                            </span>
                          );
                        })()}
                      </td>

                      {/* PHASE 3: Permission-based action buttons */}
                      <td>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {isUnassigned ? (
                            <>
                              {/* Unassigned: TA can self-assign */}
                              <button
                                className="action-button primary"
                                onClick={() => handleSelfAssign(req.id)}
                                disabled={assigningReqId === req.id}
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 12px",
                                  opacity: assigningReqId === req.id ? 0.7 : 1,
                                }}
                                title="Assign this requisition to yourself"
                              >
                                {assigningReqId === req.id ? (
                                  <>
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                      style={{ marginRight: "4px" }}
                                    />
                                    Assigning...
                                  </>
                                ) : (
                                  <>
                                    <UserPlus
                                      size={12}
                                      style={{ marginRight: "4px" }}
                                    />
                                    Self Assign
                                  </>
                                )}
                              </button>
                              {/* Unassigned: View only (no Map Resource/Shortlist) */}
                              <button
                                className="action-button"
                                onClick={() => onViewRequisition?.(req.id)}
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 12px",
                                }}
                                title="View details (assign first to manage)"
                              >
                                View Only
                              </button>
                            </>
                          ) : isAssignedToMe ? (
                            <>
                              {/* Assigned to current TA: Full access */}
                              <button
                                className="action-button primary"
                                onClick={() => onManageItems?.(req.id)}
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 12px",
                                }}
                                title="Manage items: Upload CV, Map Resource, Update Progress"
                              >
                                Manage Items
                              </button>
                              <button
                                className="action-button"
                                onClick={() => onViewRequisition?.(req.id)}
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 12px",
                                }}
                              >
                                View
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Assigned to another TA: View only, no edit */}
                              <button
                                className="action-button"
                                onClick={() => onViewRequisition?.(req.id)}
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 12px",
                                }}
                                title="View only - managed by another TA"
                              >
                                View
                              </button>
                              <span
                                style={{
                                  fontSize: "11px",
                                  color: "var(--text-tertiary)",
                                  padding: "6px 0",
                                }}
                              >
                                (Managed by {assignedLabel})
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

            {!isLoading && !error && filteredRequisitions.length === 0 && (
              <tr>
                <td colSpan={9}>
                  {activeFilter === "my" && myRequisitions.length === 0 ? (
                    <div className="tickets-empty-state empty-state">
                      <BarChart3
                        size={48}
                        style={{ marginBottom: "16px", opacity: 0.5 }}
                      />
                      <h3>Waiting for HR to assign a new requisition</h3>
                      <p>
                        Once HR assigns a requisition, it will appear in your
                        list.
                      </p>
                    </div>
                  ) : (
                    <div className="tickets-empty-state">
                      <BarChart3
                        size={48}
                        style={{ marginBottom: "16px", opacity: 0.5 }}
                      />
                      <h3>No requisitions found</h3>
                      <p>Try adjusting your filters or search criteria</p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div
        style={{
          marginTop: "24px",
          padding: "16px",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "12px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            Showing <strong>{filteredRequisitions.length}</strong> of{" "}
            <strong>{visibleRequisitions.length}</strong> requisitions
            {activeFilter === "my" && (
              <span
                style={{ marginLeft: "12px", color: "var(--primary-accent)" }}
              >
                • {myStats.pendingPositions} positions pending in your
                assignments
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <span>
              ⚡{" "}
              {
                requisitions.filter(
                  (r) => r.priority === "High" && !r.assignedTAId,
                ).length
              }{" "}
              high priority unassigned
            </span>
            <span>
              ⏱ Avg aging:{" "}
              {Math.round(
                requisitions.reduce(
                  (sum, req) => sum + calculateAgingDays(req.dateCreated),
                  0,
                ) / requisitions.length,
              )}{" "}
              days
            </span>
          </div>
        </div>
      </div>

      {/* Workflow Guidance */}
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
              TA Workflow
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              How to efficiently manage requisitions
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
                Pick Up Tickets
              </span>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              Assign yourself to unassigned requisitions or get assigned by HR
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
                Review Items
              </span>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              Each requisition has multiple items (positions) - review
              requirements
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
                Assign Resources
              </span>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              Match employees to each item - work item by item
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
                Track Progress
              </span>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              Monitor completion - requisition closes when all items are done
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
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
            Total Unassigned
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>
            {requisitions.filter((r) => !r.assignedTAId).length}
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
            High Priority Open
          </div>
          <div
            style={{ fontSize: "20px", fontWeight: 700, color: "var(--error)" }}
          >
            {
              // F-002 FIX: Use "Fulfilled" instead of "Closed"
              requisitions.filter(
                (r) => r.priority === "High" && r.overallStatus !== "Fulfilled",
              ).length
            }
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
            Total Positions
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>
            {requisitions.reduce((sum, req) => sum + req.items.length, 0)}
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
            Pending Positions
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--warning)",
            }}
          >
            {requisitions.reduce(
              (sum, req) =>
                sum +
                req.items.filter((item) => item.itemStatus === "Pending")
                  .length,
              0,
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Requisitions;
