/**
 * Manager Dashboard Types
 * Clean contracts for manager dashboard metrics and alerts.
 */

export interface ManagerSlaRiskItem {
  requisition_id: string;
  days_open: number;
}

export interface ManagerPendingPositionsAlert {
  requisition_id: string;
  pending_count: number;
}

export interface ManagerDashboardMetrics {
  total_requisitions: number;
  open: number;
  in_progress: number;
  closed: number;
  pending_positions: number;
  avg_fulfillment_days: number;
  sla_risks: ManagerSlaRiskItem[];
  pending_positions_alerts: ManagerPendingPositionsAlert[];
}
