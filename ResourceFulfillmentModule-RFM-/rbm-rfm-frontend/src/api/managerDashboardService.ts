/**
 * Manager Dashboard Service
 * Centralized API access for manager metrics.
 */

import { apiClient } from "./client";
import { ManagerDashboardMetrics } from "../types/managerDashboard";

export async function fetchManagerDashboardMetrics(
  signal?: AbortSignal,
): Promise<ManagerDashboardMetrics> {
  const response = await apiClient.get<ManagerDashboardMetrics>(
    "/dashboard/manager-metrics",
    { signal },
  );
  return response.data;
}

export const managerDashboardService = {
  getMetrics: fetchManagerDashboardMetrics,
};

export default managerDashboardService;
