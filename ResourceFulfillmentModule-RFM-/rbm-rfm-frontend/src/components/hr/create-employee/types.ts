export type ContactType = "work" | "personal" | "emergency";

export type ProficiencyLevel = "Junior" | "Mid" | "Senior";

export type ContactInput = {
  type: ContactType;
  email: string;
  phone: string;
  address: string;
};

export type SkillInput = {
  skill_id: number;
  proficiency_level: ProficiencyLevel;
  years_experience: number;
};

export type EducationInput = {
  qualification: string;
  specialization: string;
  institution: string;
  year_completed: string;
};

export type CreateEmployeeForm = {
  core: {
    empId: string;
    fullName: string;
    departmentId: string;
    roleId: string;
    dob: string;
    gender: string;
    doj: string;
  };
  contacts: ContactInput[];
  skills: SkillInput[];
  education: EducationInput[];
  deployment: {
    availabilityPct: number;
    effectiveFrom: string;
    managerId: string;
    locationId: string;
  };
  finance: {
    bankDetails: string;
    taxId: string;
  };
};

export type DepartmentOption = {
  department_id: number;
  department_name: string;
};

export type RoleOption = {
  role_id: number;
  role_name: string;
  is_active?: boolean;
};

export type SkillOption = {
  skill_id: number;
  skill_name: string;
};

export type LocationOption = {
  location_id: number;
  city?: string | null;
  country?: string | null;
};

export type UserOption = {
  user_id: number;
  username: string;
  roles?: string[];
};

export type ManagerOption = {
  emp_id: string;
  full_name: string;
};
