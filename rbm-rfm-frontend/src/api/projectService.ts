/**
 * Project Management API Service
 */

import { apiClient } from "./client";
import { 
  Project, 
  ProjectTimeline, 
  EmployeeProjectAssignment, 
  ProjectCreateRequest, 
  ProjectUpdateRequest,
  AssignmentCreateRequest
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

  // Timelines
  createTimeline: (data: Partial<ProjectTimeline>) => 
    apiClient.post<ProjectTimeline>("/projects/timelines", data),

  // Assignments (Billing details are handled here)
  assignEmployee: (data: AssignmentCreateRequest) => 
    apiClient.post<EmployeeProjectAssignment>("/projects/assignments", data),
    
  getProjectAssignments: (projectId: number) => 
    apiClient.get<EmployeeProjectAssignment[]>(`/projects/projects/${projectId}/assignments`),
    
  updateAssignment: (assignmentId: number, data: Partial<EmployeeProjectAssignment>) => 
    apiClient.patch<EmployeeProjectAssignment>(`/projects/assignments/${assignmentId}`, data),
};