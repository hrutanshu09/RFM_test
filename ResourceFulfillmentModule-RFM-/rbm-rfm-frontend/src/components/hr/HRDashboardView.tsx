/**
 * HRDashboard.tsx
 * Fully wired HR Dashboard with real backend data.
 * Uses proper service layer, RBAC, and follows architecture conventions.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserCheck,
  UserPlus,
  Clock,
  AlertCircle,
  ArrowUpRight,
  Activity,
  Briefcase,
  RefreshCw,
  CheckCircle,
  XCircle,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "../../contexts/useAuth";
import {
  hrDashboardService,
  HRMetrics,
  RecentActivity,
} from "../../api/hrDashboardService";
import HRPendingApprovals from "./HRPendingApprovals";
import ItemBudgetApprovalPanel from "./ItemBudgetApprovalPanel";

// ============================================
// Types
// ============================================

interface HRDashboardProps {
  onViewRequisition?: (reqId: number) => void;
}

type LoadingState = "idle" | "loading" | "success" | "error";

// ============================================
// Helper Functions
// ============================================

/**
 * Format timestamp to relative time or date
 */
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
    });
  } catch {
    return timestamp;
  }
}

/**
 * Format action name for display
 */
function formatAction(action: string): string {
  const actionMap: Record<string, string> = {
    CREATE: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
    APPROVE: "Approved",
    HR_APPROVE: "HR Approved",
    REJECT: "Rejected",
    HR_REJECT: "HR Rejected",
    ASSIGN: "Assigned",
    ONBOARD: "Onboarded",
    STATUS_CHANGE: "Status Changed",
  };
  return actionMap[action] || action;
}

/**
 * Get action icon color
 */
function getActionColor(action: string): string {
  if (action.includes("APPROVE")) return "text-green-600";
  if (action.includes("REJECT") || action.includes("DELETE"))
    return "text-red-600";
  if (action.includes("CREATE") || action.includes("ONBOARD"))
    return "text-blue-600";
  return "text-slate-600";
}

// ============================================
// Metric Card Component
// ============================================

interface MetricCardProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  trend?: { value: string; positive: boolean };
  subtext?: string;
  colorClass?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon,
  value,
  label,
  trend,
  subtext,
  colorClass = "",
}) => (
  <div className="stat-card">
    <div className={`stat-icon-wrapper ${colorClass}`}>{icon}</div>
    <span className="stat-number">{value}</span>
    <span className="stat-label">{label}</span>
    {trend && (
      <div
        className={`text-xs mt-2 flex items-center ${
          trend.positive ? "text-green-600" : "text-red-600"
        }`}
      >
        <ArrowUpRight size={12} className={trend.positive ? "" : "rotate-90"} />
        <span className="ml-1">{trend.value}</span>
      </div>
    )}
    {subtext && <div className="text-xs text-slate-500 mt-2">{subtext}</div>}
  </div>
);

// ============================================
// Empty State Component
// ============================================

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
}) => (
  <div className="flex flex-col items-center justify-center py-8 text-center">
    <div className="text-slate-300 mb-3">{icon}</div>
    <p className="text-slate-500 font-medium">{title}</p>
    {description && <p className="text-slate-400 text-sm">{description}</p>}
  </div>
);

// ============================================
// Loading Skeleton Component
// ============================================

const LoadingSkeleton: React.FC = () => (
  <div className="animate-pulse">
    <div className="admin-metrics mb-6">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="stat-card">
          <div className="h-10 w-10 bg-slate-200 rounded-lg mb-3"></div>
          <div className="h-8 w-16 bg-slate-200 rounded mb-2"></div>
          <div className="h-4 w-24 bg-slate-200 rounded"></div>
        </div>
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white rounded-lg p-6">
        <div className="h-6 w-40 bg-slate-200 rounded mb-4"></div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-slate-100 rounded mb-2"></div>
        ))}
      </div>
      <div className="bg-white rounded-lg p-6">
        <div className="h-6 w-32 bg-slate-200 rounded mb-4"></div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-slate-100 rounded mb-2"></div>
        ))}
      </div>
    </div>
  </div>
);

// ============================================
// Unauthorized Component
// ============================================

const UnauthorizedView: React.FC<{ onNavigate: () => void }> = ({
  onNavigate,
}) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
    <ShieldAlert size={64} className="text-red-400 mb-4" />
    <h2 className="text-xl font-semibold text-slate-800 mb-2">Access Denied</h2>
    <p className="text-slate-500 mb-6">
      You don't have permission to access the HR Dashboard.
      <br />
      This view requires HR or Admin role.
    </p>
    <button className="action-button primary" onClick={onNavigate}>
      Return to Home
    </button>
  </div>
);

// ============================================
// Error View Component
// ============================================

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

const ErrorView: React.FC<ErrorViewProps> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
    <AlertCircle size={48} className="text-red-400 mb-4" />
    <h3 className="text-lg font-medium text-slate-800 mb-2">
      Failed to Load Dashboard
    </h3>
    <p className="text-slate-500 mb-4">{message}</p>
    <button className="action-button primary" onClick={onRetry}>
      <RefreshCw size={16} className="mr-2" />
      Try Again
    </button>
  </div>
);

// ============================================
// Main HRDashboard Component
// ============================================

const HRDashboard: React.FC<HRDashboardProps> = ({ onViewRequisition }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // State
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [metrics, setMetrics] = useState<HRMetrics | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Tab state for approval views
  const [approvalTab, setApprovalTab] = useState<"budget" | "hr">("budget");

  // RBAC Check
  const hasHRAccess = useMemo(() => {
    if (!user?.roles) return false;
    const normalizedRoles = user.roles.map((r) => r.toLowerCase());
    return normalizedRoles.includes("hr") || normalizedRoles.includes("admin");
  }, [user]);

  // Fetch dashboard data
  const fetchDashboardData = useCallback(
    async (showLoader: boolean = true) => {
      if (!hasHRAccess) return;

      const controller = new AbortController();

      try {
        if (showLoader) {
          setLoadingState("loading");
        } else {
          setIsRefreshing(true);
        }
        setErrorMessage("");

        const data = await hrDashboardService.getDashboardData(
          controller.signal,
        );

        setMetrics(data.metrics);
        setRecentActivity(data.recent_activity);
        setLoadingState("success");
      } catch (error) {
        if (controller.signal.aborted) return;

        const errMsg =
          error instanceof Error
            ? error.message
            : "Unable to load dashboard data";
        setErrorMessage(errMsg);
        setLoadingState("error");
      } finally {
        setIsRefreshing(false);
      }

      return () => controller.abort();
    },
    [hasHRAccess],
  );

  // Initial load
  useEffect(() => {
    if (hasHRAccess) {
      fetchDashboardData();
    }
  }, [hasHRAccess, fetchDashboardData]);

  // Handle refresh
  const handleRefresh = () => {
    fetchDashboardData(false);
  };

  // Handle view requisition
  const handleViewRequisition = (reqId: number) => {
    if (onViewRequisition) {
      onViewRequisition(reqId);
    }
  };

  // Unauthorized state
  if (!hasHRAccess) {
    return <UnauthorizedView onNavigate={() => navigate("/")} />;
  }

  // Loading state
  if (loadingState === "loading") {
    return (
      <div className="admin-content-area">
        <div className="header-title mb-6">
          <h1>HR Dashboard</h1>
          <p>Loading your workforce data...</p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (loadingState === "error") {
    return (
      <div className="admin-content-area">
        <div className="header-title mb-6">
          <h1>HR Dashboard</h1>
        </div>
        <ErrorView
          message={errorMessage}
          onRetry={() => fetchDashboardData()}
        />
      </div>
    );
  }

  // Success state with data
  return (
    <div className="admin-content-area">
      {/* Header */}
      <div className="header-title mb-6 flex items-start justify-between">
        <div>
          <h1>HR Dashboard</h1>
          <p>Welcome back, {user?.username}! Here's your workforce overview.</p>
        </div>
        <button
          className="action-button"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            size={16}
            className={`mr-2 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Metrics Grid */}
      {metrics && (
        <div className="admin-metrics">
          <MetricCard
            icon={<Users size={20} />}
            value={metrics.total_employees}
            label="Total Employees"
            colorClass="total-employees"
          />
          <MetricCard
            icon={<UserCheck size={20} />}
            value={metrics.active_employees}
            label="Active"
            colorClass="users"
          />
          <MetricCard
            icon={<UserPlus size={20} />}
            value={metrics.onboarding_employees}
            label="Onboarding"
            subtext={
              metrics.pending_hr_approvals > 0
                ? `${metrics.pending_hr_approvals} pending actions`
                : undefined
            }
          />
          {/* <MetricCard
            icon={<Briefcase size={20} />}
            value={metrics.bench_employees}
            label="On Bench"
            colorClass="uptime"
          /> */}
          <MetricCard
            icon={<Clock size={20} />}
            value={metrics.upcoming_probation_count}
            label="Probation Due"
            subtext="Next 30 days"
          />
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 mt-6">
        {/* Approval Tabs */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {/* Tab Header */}
          <div className="border-b border-slate-200">
            <nav className="flex" aria-label="Approval tabs">
              <button
                onClick={() => setApprovalTab("budget")}
                className={`px-6 py-4 text-sm font-medium transition-colors relative ${
                  approvalTab === "budget"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Briefcase size={16} />
                  Item Budget Approvals
                </span>
              </button>
              <button
                onClick={() => setApprovalTab("hr")}
                className={`px-6 py-4 text-sm font-medium transition-colors relative ${
                  approvalTab === "hr"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <UserCheck size={16} />
                  HR Approvals
                </span>
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-4">
            {approvalTab === "budget" && <ItemBudgetApprovalPanel />}
            {approvalTab === "hr" && (
              <HRPendingApprovals
                onViewRequisition={handleViewRequisition}
                onActionComplete={() => fetchDashboardData(false)}
              />
            )}
          </div>
        </div>

        {/* <div className="space-y-3">
              <button className="action-button primary w-full justify-center">
                <UserPlus size={16} />
                <span className="ml-2">Create New Employee</span>
              </button>
              <button className="action-button w-full justify-center">
                <Calendar size={16} />
                <span className="ml-2">Schedule Appraisal</span>
              </button>
              <button className="action-button w-full justify-center">
                <TrendingUp size={16} />
                <span className="ml-2">Generate Reports</span>
              </button>
            </div> */}

        {/* <div className="audit-log-viewer">
            <div className="viewer-header">
              <h2>Recent Activity</h2>
              <p className="subtitle">Latest HR actions</p>
            </div>

            {recentActivity.length === 0 ? (
              <EmptyState
                icon={<Activity size={32} />}
                title="No recent activity"
              />
            ) : (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <div
                    key={activity.audit_id}
                    className="flex items-start justify-between p-3 bg-slate-50 rounded-lg"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 ${getActionColor(activity.action)}`}
                      >
                        {activity.action.includes("APPROVE") ? (
                          <CheckCircle size={16} />
                        ) : activity.action.includes("REJECT") ? (
                          <XCircle size={16} />
                        ) : (
                          <Activity size={16} />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          {formatAction(activity.action)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {activity.entity_name}
                          {activity.entity_id && ` #${activity.entity_id}`}
                        </div>
                        {activity.performed_by_name && (
                          <div className="text-xs text-slate-400">
                            by {activity.performed_by_name}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">
                      {formatTimestamp(activity.performed_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div> */}
        {/* {metrics && (
            <div className="audit-log-viewer">
              <div className="viewer-header">
                <h2>Employee Status</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">On Leave</span>
                  <span className="font-medium">
                    {metrics.on_leave_employees}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Exited</span>
                  <span className="font-medium">
                    {metrics.exited_employees}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Pending HR Approvals</span>
                  <span className="font-medium text-amber-600">
                    {metrics.pending_hr_approvals}
                  </span>
                </div>
              </div>
            </div>
          )} */}
      </div>
    </div>
  );
};

export default HRDashboard;
