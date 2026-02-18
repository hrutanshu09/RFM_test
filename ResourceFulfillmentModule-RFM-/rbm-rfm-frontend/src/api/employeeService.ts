import { apiClient } from "./client";

export type OnboardContact = {
  type: "work" | "personal" | "emergency";
  email?: string;
  phone?: string;
  address?: string;
};

export type OnboardSkill = {
  skill_id: number;
  proficiency_level?: string;
  years_experience?: number;
};

export type OnboardEducation = {
  qualification?: string;
  specialization?: string;
  institution?: string;
  year_completed?: number | null;
};

export type OnboardAvailability = {
  availability_pct: number;
  effective_from: string;
};

export type OnboardFinance = {
  bank_details?: string;
  tax_id?: string;
};

export type EmployeeOnboardPayload = {
  emp_id: string;
  full_name: string;
  rbm_email: string;
  dob?: string | null;
  gender?: string | null;
  doj?: string | null;
  contacts: OnboardContact[];
  skills: OnboardSkill[];
  education: OnboardEducation[];
  availability?: OnboardAvailability | null;
  finance?: OnboardFinance | null;
};

export type EmployeeValidateResponse = {
  emp_id_exists: boolean;
  work_email_exists: boolean;
};

export type SkillRecord = {
  skill_id: number;
  skill_name: string;
};

export const employeeService = {
  onboard: (payload: EmployeeOnboardPayload) =>
    apiClient.post("/employees/onboard", payload),

  validate: (empId?: string, workEmail?: string) =>
    apiClient.get<EmployeeValidateResponse>("/employees/validate", {
      params: {
        emp_id: empId || undefined,
        work_email: workEmail || undefined,
      },
    }),

  verifySkill: async (skillId: number) => {
    const response = await apiClient.get<SkillRecord[]>("/skills/");
    return (response.data ?? []).some((skill) => skill.skill_id === skillId);
  },
};
