/**
 * Project Management Types
 */

export interface Project {
  project_id: number;
  project_name: string;
  client_name?: string;
  project_status: 'Active' | 'On Hold' | 'Completed' | 'Cancelled';
  description?: string;
  created_at: string;
  manager_name?: string;
  manager_user_id?: number;
  planned_start_date?: string;
  planned_end_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
}

export interface ProjectTimeline {
  timeline_id: number;
  project_id: number;
  planned_start_date?: string;
  actual_start_date?: string;
  planned_end_date: string;
  actual_end_date?: string;
  version_number: number;
  reason_for_change?: string;
  is_current: boolean;
}

export interface EmployeeProjectAssignment {
  assignment_id: number;
  emp_id: string;
  project_id: number;
  role?: string;
  allocation_pct: number;
  start_date: string;
  end_date?: string;
  status: 'Planned' | 'Active' | 'Ended';
  
  // --- New Billing & Metadata Fields ---
  billing_rate?: number; // Will be null for non-admins due to masking
  billing_start_date?: string;
  billing_end_date?: string;
  is_billable: boolean;
  timesheet_required: boolean;
  client_pm_name?: string;
  billing_project_id?: number;
}

export interface ProjectManagerAssignment {
  id: number;
  project_id: number;
  manager_user_id: number;
  role: string;
  assigned_from: string;
  assigned_to?: string;
  is_active: boolean;
}

// Request Types for Mutations
export type ProjectCreateRequest = Omit<Project, 'project_id' | 'created_at'> & {
  manager_user_id?: number;
  planned_start_date?: string;
  planned_end_date?: string;
};
export type ProjectUpdateRequest = Partial<ProjectCreateRequest> & {
  actual_start_date?: string;
  actual_end_date?: string;
  reason_for_change?: string;
};
export type AssignmentCreateRequest = Omit<EmployeeProjectAssignment, 'assignment_id'>;

import { apiClient } from "./client";

export const createProject = async (
  payload: ProjectCreateRequest,
): Promise<Project> => {
  const res = await apiClient.post<Project>("/projects/", payload);
  return res.data;
};

