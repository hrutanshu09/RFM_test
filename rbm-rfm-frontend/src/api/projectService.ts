/**
 * Project Management API Service
 */

import { apiClient } from "./client";
import type {
  Project, 
  ProjectTimeline, 
  EmployeeProjectAssignment, 
  ProjectCreateRequest, 
  ProjectUpdateRequest,
  ProjectApprovalRequest,
  AssignmentApprovalRequest,
  AssignmentCreateRequest,
  SkillSearchResponse,
  SkillRecommendationRequest,
  SkillRecommendationResponse,
} from "../types/projects";

export const projectService = {
  // Project CRUD
  getProjects: () => 
    apiClient.get<Project[]>("/projects/"),
    
  getProject: (projectId: number) => 
    apiClient.get<Project>(`/projects/${projectId}`),
    
  createProject: (data: ProjectCreateRequest) => 
    apiClient.post<Project>("/projects/", data),
    
  updateProject: (projectId: number, data: ProjectUpdateRequest) => 
    apiClient.patch<Project>(`/projects/${projectId}`, data),

  updateApproval: (projectId: number, data: ProjectApprovalRequest) =>
    apiClient.patch<Project>(`/projects/${projectId}/approval`, data),

  // Timelines
  createTimeline: (data: Partial<ProjectTimeline>) => 
    apiClient.post<ProjectTimeline>("/projects/timelines", data),
  getProjectTimelines: (projectId: number) =>
    apiClient.get<ProjectTimeline[]>(`/projects/${projectId}/timelines`),

  // Assignments (Billing details are handled here)
  assignEmployee: (data: AssignmentCreateRequest) => 
    apiClient.post<EmployeeProjectAssignment>("/projects/assignments", data),
    
  getProjectAssignments: (projectId: number) => 
    apiClient.get<EmployeeProjectAssignment[]>(`/projects/projects/${projectId}/assignments`),

  searchEmployeesBySkill: (projectId: number, query: string, limit = 20) =>
    apiClient.get<SkillSearchResponse>(
      `/projects/${projectId}/skill-search`,
      { params: { query, limit } },
    ),

  recommendEmployeesBySkill: (projectId: number, payload: SkillRecommendationRequest) =>
    apiClient.post<SkillRecommendationResponse>(
      `/projects/${projectId}/skill-recommendations`,
      payload,
    ),
    
  updateAssignment: (assignmentId: number, data: Partial<EmployeeProjectAssignment>) => 
    apiClient.patch<EmployeeProjectAssignment>(`/projects/assignments/${assignmentId}`, data),

  updateAssignmentApproval: (assignmentId: number, data: AssignmentApprovalRequest) =>
    apiClient.patch<EmployeeProjectAssignment>(`/projects/assignments/${assignmentId}/approval`, data),
};
