import { apiClient } from "./client";

export interface EmployeeOption {
  emp_id: string;
  full_name: string;
  user_id?: number | null;
}

export interface EmployeeSkillAssignment {
  emp_id: string;
  skill_id: number;
  proficiency_level?: string | null;
  years_experience?: number | null;
}

export interface SkillCatalogItem {
  skill_id: number;
  skill_name: string;
}

export const fetchEmployees = async (): Promise<EmployeeOption[]> => {
  const response = await apiClient.get<EmployeeOption[]>("/employees/employees");
  return response.data;
};

export const fetchEmployeeSkillAssignments = async (empId: string): Promise<EmployeeSkillAssignment[]> => {
  const response = await apiClient.get<EmployeeSkillAssignment[]>(`/employees/${empId}/skills/`);
  return response.data;
};

export const fetchSkillCatalog = async (): Promise<SkillCatalogItem[]> => {
  const response = await apiClient.get<SkillCatalogItem[]>("/skills/");
  return response.data;
};
