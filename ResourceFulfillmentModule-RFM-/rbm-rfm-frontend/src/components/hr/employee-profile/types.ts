export type EmployeeCore = {
  emp_id: string;
  full_name: string;
  rbm_email: string;
  emp_status: string;
  dob?: string | null;
  gender?: string | null;
  doj?: string | null;
  company_role_id?: number | null;
};

export type EmployeeDirectoryEntry = {
  emp_id: string;
  full_name: string;
  rbm_email?: string | null;
  emp_status?: string | null;
  department_name?: string | null;
};

export type EmployeeContact = {
  emp_id: string;
  contact_type: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type EmployeeSkill = {
  emp_id: string;
  skill_id: number;
  proficiency_level?: string | null;
  years_experience?: number | null;
};

export type EmployeeEducation = {
  edu_id: number;
  emp_id: string;
  qualification: string;
  specialization?: string | null;
  institution?: string | null;
  year_completed?: number | null;
};

export type EmployeeFinance = {
  emp_id: string;
  bank_details?: string | null;
  tax_id?: string | null;
};

export type SkillCatalog = {
  skill_id: number;
  skill_name: string;
};

export type Department = {
  department_id: number;
  department_name: string;
};

export type Assignment = {
  assignment_id: number;
  department_id: number;
  start_date: string;
  end_date?: string | null;
};
