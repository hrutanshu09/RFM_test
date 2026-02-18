import { apiClient } from "./client";

export interface EmployeeOption {
  emp_id: string;
  full_name: string;
  user_id?: number | null;
}

export const fetchEmployees = async (): Promise<EmployeeOption[]> => {
  const response = await apiClient.get<EmployeeOption[]>("/employees/employees");
  return response.data;
};
