/**
 * HR Dashboard Service
 * API layer for HR dashboard data fetching
 */

import { apiClient } from "./client";

// ============================================
// Type Definitions
// ============================================

export interface HRMetrics {
  total_employees: number;
  active_employees: number;
  onboarding_employees: number;
  on_leave_employees: number;
  exited_employees: number;
  bench_employees: number;
  pending_hr_approvals: number;
  upcoming_probation_count: number;
}

export interface PendingApproval {
  req_id: number;
  project_name: string | null;
  client_name: string | null;
  requester_name: string;
  priority: string | null;
  overall_status: string;
  budget_amount: number | null;
  required_by_date: string | null;
  created_at: string;
}

export interface HRPendingApprovalItem {
  requisition_id: string;
  project_name: string | null;
  manager_name: string | null;
  requested_date: string | null;
  budget_amount: number | null;
  status: string;
}

// ============================================
// Item Budget Types (Item-Level Budget Architecture)
// ============================================

export interface RequisitionItemBudget {
  item_id: number;
  req_id: number;
  role_position: string;
  skill_level: string | null;
  experience_years: number | null;
  item_status: string;
  estimated_budget: number | null;
  approved_budget: number | null;
  currency: string;
}

export interface PendingBudgetRequisition {
  req_id: number;
  project_name: string | null;
  client_name: string | null;
  overall_status: string;
  raised_by_name: string | null;
  created_at: string | null;
  items: RequisitionItemBudget[];
  // Computed totals (from items)
  total_estimated_budget: number | null;
  total_approved_budget: number | null;
  budget_approval_status: "none" | "pending" | "partial" | "approved" | null;
}

export interface RecentActivity {
  audit_id: number;
  action: string;
  entity_name: string;
  entity_id: string | null;
  performed_at: string;
  performed_by_name: string | null;
}

export interface HRDashboardData {
  metrics: HRMetrics;
  pending_approvals: PendingApproval[];
  recent_activity: RecentActivity[];
}

// ============================================
// Service Functions
// ============================================

/**
 * Fetch complete HR dashboard data including metrics, pending approvals, and recent activity.
 * Requires HR or Admin role.
 */
export async function fetchHRDashboardData(
  signal?: AbortSignal,
): Promise<HRDashboardData> {
  const response = await apiClient.get<HRDashboardData>(
    "/dashboard/hr-metrics",
    { signal },
  );
  return response.data;
}

/**
 * Fetch only HR metrics summary (lightweight version).
 * Requires HR or Admin role.
 */
export async function fetchHRMetricsSummary(
  signal?: AbortSignal,
): Promise<HRMetrics> {
  const response = await apiClient.get<HRMetrics>(
    "/dashboard/hr-metrics/summary",
    { signal },
  );
  return response.data;
}

// ============================================
// Service Object Export (Alternative pattern)
// ============================================

export const hrDashboardService = {
  /**
   * Fetch complete HR dashboard data
   */
  getDashboardData: fetchHRDashboardData,

  /**
   * Fetch only metrics summary
   */
  getMetricsSummary: fetchHRMetricsSummary,

  /**
   * Fetch pending HR approvals (dedicated endpoint)
   */
  getPendingApprovals: async (signal?: AbortSignal) => {
    const response = await apiClient.get<HRPendingApprovalItem[]>(
      "/dashboard/hr/pending-approvals",
      { signal },
    );
    return response.data;
  },

  /**
   * Fetch requisitions pending budget approval with item-level details.
   * Used by ItemBudgetApprovalPanel.
   */
  getPendingBudgetRequisitions: async (
    signal?: AbortSignal,
  ): Promise<PendingBudgetRequisition[]> => {
    const response = await apiClient.get<PendingBudgetRequisition[]>(
      "/requisitions/",
      {
        params: { status: "Pending_Budget" },
        signal,
      },
    );
    return response.data;
  },
};

export default hrDashboardService;
