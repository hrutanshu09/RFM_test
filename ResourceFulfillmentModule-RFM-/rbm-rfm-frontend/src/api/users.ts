import { apiClient } from "./client";

export interface AdminUser {
  user_id: number;
  username: string;
  emp_id?: string | null;
  employee?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  is_active: boolean;
  roles: string[];
}

export interface UpdateUserPayload {
  roles?: string[];
  is_active?: boolean;
  employee_id?: string | null;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: string;
}

export const fetchUsers = async (search?: string): Promise<AdminUser[]> => {
  const response = await apiClient.get<AdminUser[]>("/admin/users/", {
    params: search ? { search } : undefined,
  });
  return response.data;
};

export const updateUser = async (
  userId: number,
  payload: UpdateUserPayload,
): Promise<void> => {
  await apiClient.put(`/admin/users/${userId}`, payload);
};

export const deleteUser = async (userId: number): Promise<void> => {
  await apiClient.delete(`/admin/users/${userId}`);
};

export const createUser = async (
  payload: CreateUserPayload,
): Promise<void> => {
  // 1) Create the user account (username + password)
  const createResponse = await apiClient.post<{ user_id: number }>("/users/", {
    username: payload.username,
    password: payload.password,
  });

  const userId = createResponse.data.user_id;

  // 2) Assign the primary role
  if (payload.role) {
    await apiClient.post(`/users/${userId}/roles`, {
      role_name: payload.role,
    });
  }
}
