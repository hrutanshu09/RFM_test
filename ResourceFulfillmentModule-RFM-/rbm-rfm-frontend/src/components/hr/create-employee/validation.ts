import { z } from "zod";

import type { CreateEmployeeForm } from "./types";

const phoneRegex = /^\+?[0-9]{7,15}$/;

const contactSchema = z
  .object({
    type: z.enum(["work", "personal", "emergency"]),
    email: z
      .string()
      .email("Valid email required")
      .optional()
      .or(z.literal("")),
    phone: z
      .string()
      .optional()
      .or(z.literal(""))
      .refine((value) => !value || phoneRegex.test(value), {
        message: "Valid phone number required",
      }),
    address: z.string().optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.type === "work" && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Work email is required",
        path: ["email"],
      });
    }
  });

const skillSchema = z.object({
  skill_id: z.number(),
  proficiency_level: z.enum(["Junior", "Mid", "Senior"]),
  years_experience: z.number().min(0),
});

const educationSchema = z.object({
  qualification: z.string().min(1, "Qualification is required"),
  specialization: z.string().optional().or(z.literal("")),
  institution: z.string().optional().or(z.literal("")),
  year_completed: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || /^\d{4}$/.test(value), {
      message: "Year must be numeric",
    }),
});

const coreSchema = z.object({
  empId: z.string().min(1, "Employee ID required"),
  fullName: z.string().min(1, "Full name required"),
  departmentId: z.string().min(1, "Department required"),
  roleId: z.string().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  doj: z.string().optional(),
});

const deploymentSchema = z.object({
  availabilityPct: z
    .number()
    .min(0, "Availability must be between 0 and 100")
    .max(100, "Availability must be between 0 and 100"),
  effectiveFrom: z.string().min(1, "Effective from date required"),
  managerId: z.string().optional(),
  locationId: z.string().min(1, "Work location required"),
});

const financeSchema = z.object({
  bankDetails: z.string().optional(),
  taxId: z.string().optional(),
});

const skillsContactsSchema = z.object({
  contacts: z.array(contactSchema),
  skills: z.array(skillSchema),
  education: z.array(educationSchema),
});

export type FormErrorMap = Record<string, string>;

const mapErrors = (error: z.ZodError) => {
  const errors: FormErrorMap = {};
  error.issues.forEach((issue) => {
    const path = issue.path.join(".");
    if (!errors[path]) {
      errors[path] = issue.message;
    }
  });
  return errors;
};

export const validateCoreStep = (
  data: CreateEmployeeForm,
  requireRole: boolean,
) => {
  const result = coreSchema.safeParse(data.core);
  const errors = result.success ? {} : mapErrors(result.error);

  if (requireRole && !data.core.roleId) {
    errors["core.roleId"] = "Role required";
  }

  return { isValid: Object.keys(errors).length === 0, errors };
};

export const validateSkillsContactsStep = (data: CreateEmployeeForm) => {
  const result = skillsContactsSchema.safeParse({
    contacts: data.contacts,
    skills: data.skills,
    education: data.education,
  });
  const base = result.success
    ? { isValid: true, errors: {} }
    : { isValid: false, errors: mapErrors(result.error) };

  const workContactIndex = data.contacts.findIndex(
    (contact) => contact.type === "work",
  );
  if (workContactIndex === -1 || !data.contacts[workContactIndex]?.email) {
    base.isValid = false;
    const key =
      workContactIndex === -1
        ? "contacts.0.email"
        : `contacts.${workContactIndex}.email`;
    base.errors[key] = "Work email is required";
  }

  return base;
};

export const validateDeploymentStep = (data: CreateEmployeeForm) => {
  const result = deploymentSchema.safeParse(data.deployment);
  return result.success
    ? { isValid: true, errors: {} }
    : { isValid: false, errors: mapErrors(result.error) };
};

export const validateFinanceStep = (data: CreateEmployeeForm) => {
  const result = financeSchema.safeParse(data.finance);
  return result.success
    ? { isValid: true, errors: {} }
    : { isValid: false, errors: mapErrors(result.error) };
};
