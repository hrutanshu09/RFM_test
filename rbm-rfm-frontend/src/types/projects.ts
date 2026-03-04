/**
 * Project Management Types
 */

export interface Project {
  project_id: number;
  project_name: string;
  client_name?: string;
  project_status: 'Active' | 'On Hold' | 'Completed' | 'Cancelled';
  description?: string;
  approval_status: 'Pending' | 'Approved' | 'Rejected';
  approved_by_manager_id?: number | null;
  approved_at?: string | null;
  approval_note?: string | null;
  can_current_user_approve?: boolean;
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
  approval_status?: 'Pending' | 'Approved' | 'Rejected';
  approved_by_manager_id?: number | null;
  approved_at?: string | null;
  approval_note?: string | null;
  approval_requested_by_user_id?: number | null;
  approval_requested_at?: string | null;
  can_current_user_approve?: boolean;
  
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
export type ProjectCreateRequest = Omit<
  Project,
  | 'project_id'
  | 'created_at'
  | 'approval_status'
  | 'approved_by_manager_id'
  | 'approved_at'
  | 'approval_note'
  | 'can_current_user_approve'
  | 'manager_name'
> & {
  manager_user_id?: number;
  planned_start_date?: string;
  planned_end_date?: string;
};
export type ProjectUpdateRequest = Partial<ProjectCreateRequest> & {
  actual_start_date?: string;
  actual_end_date?: string;
  reason_for_change?: string;
};

export interface ProjectApprovalRequest {
  approval_status: 'Approved' | 'Rejected';
  approval_note?: string;
}

export interface AssignmentApprovalRequest {
  approval_status: 'Approved' | 'Rejected';
  approval_note?: string;
}

export interface SkillSearchEmployeeResult {
  emp_id: string;
  full_name: string;
  matched_skills: string[];
  match_type: 'exact' | 'partial' | 'related';
  already_allocated_to_project: boolean;
  allocated_elsewhere: boolean;
  status: 'Available' | 'Already allocated to this project' | 'Allocated elsewhere';
}

export interface SkillSearchResponse {
  query: string;
  limit: number;
  results: SkillSearchEmployeeResult[];
}

export interface SkillRecommendationRequest {
  requested_skills: string[];
  required_count?: number;
  allow_existing_project_assignments?: boolean;
  ai_enabled?: boolean;
}

export interface SkillRecommendationEmployeeResult {
  emp_id: string;
  full_name: string;
  matched_skills: string[];
  related_skills: string[];
  skill_groups: Record<string, string[]>;
  rationale: string;
  relevance_note: string;
  already_allocated_to_project: boolean;
  allocated_elsewhere: boolean;
  status: 'Available' | 'Already allocated to this project' | 'Allocated elsewhere';
}

export interface SkillRecommendationResponse {
  requested_skills: string[];
  required_count: number;
  used_ai_rerank: boolean;
  results: SkillRecommendationEmployeeResult[];
}
export type AssignmentCreateRequest = Omit<
  EmployeeProjectAssignment,
  | 'assignment_id'
  | 'approval_status'
  | 'approved_by_manager_id'
  | 'approved_at'
  | 'approval_note'
  | 'approval_requested_by_user_id'
  | 'approval_requested_at'
  | 'can_current_user_approve'
> & {
  send_for_approval?: boolean;
};

