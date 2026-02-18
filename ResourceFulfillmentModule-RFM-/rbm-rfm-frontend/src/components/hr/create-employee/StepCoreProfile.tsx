import React from "react";
import type { CreateEmployeeForm, DepartmentOption, RoleOption } from "./types";
import type { FormErrorMap } from "./validation";

type StepCoreProfileProps = {
  formData: CreateEmployeeForm;
  departments: DepartmentOption[];
  roles: RoleOption[];
  errors: FormErrorMap;
  onChange: (field: keyof CreateEmployeeForm["core"], value: string) => void;
  isDisabled: boolean;
};

const StepCoreProfile: React.FC<StepCoreProfileProps> = ({
  formData,
  departments,
  roles,
  errors,
  onChange,
  isDisabled,
}) => {
  const core = formData.core;
  return (
    <div className="section-content">
      <div className="form-grid">
        <div className="form-field auto-generated-field">
          <label>Employee ID</label>
          <input value={core.empId} readOnly />
        </div>

        <div
          className={`form-field ${errors["core.fullName"] ? "invalid" : ""}`}
          data-error={errors["core.fullName"] ? "true" : undefined}
        >
          <label>Full Name</label>
          <input
            value={core.fullName}
            onChange={(event) => onChange("fullName", event.target.value)}
            placeholder="Employee full name"
            disabled={isDisabled}
          />
          {errors["core.fullName"] && (
            <div className="validation-message error">
              {errors["core.fullName"]}
            </div>
          )}
        </div>

        <div
          className={`form-field ${
            errors["core.departmentId"] ? "invalid" : ""
          }`}
          data-error={errors["core.departmentId"] ? "true" : undefined}
        >
          <label>Department</label>
          <select
            value={core.departmentId}
            onChange={(event) => onChange("departmentId", event.target.value)}
            disabled={isDisabled}
          >
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.department_id} value={dept.department_id}>
                {dept.department_name}
              </option>
            ))}
          </select>
          {errors["core.departmentId"] && (
            <div className="validation-message error">
              {errors["core.departmentId"]}
            </div>
          )}
        </div>

        <div
          className={`form-field ${errors["core.roleId"] ? "invalid" : ""}`}
          data-error={errors["core.roleId"] ? "true" : undefined}
        >
          <label>Role</label>
          <select
            value={core.roleId}
            onChange={(event) => onChange("roleId", event.target.value)}
            disabled={isDisabled || roles.length === 0}
          >
            <option value="">
              {roles.length === 0 ? "No roles available" : "Select role"}
            </option>
            {roles.map((role) => (
              <option key={role.role_id} value={role.role_id}>
                {role.role_name}
              </option>
            ))}
          </select>
          {errors["core.roleId"] && (
            <div className="validation-message error">
              {errors["core.roleId"]}
            </div>
          )}
        </div>

        <div className="form-field">
          <label>Date of Birth</label>
          <input
            type="date"
            value={core.dob}
            onChange={(event) => onChange("dob", event.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="form-field">
          <label>Gender</label>
          <select
            value={core.gender}
            onChange={(event) => onChange("gender", event.target.value)}
            disabled={isDisabled}
          >
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Non-binary">Non-binary</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </div>

        <div className="form-field">
          <label>Date of Joining</label>
          <input
            type="date"
            value={core.doj}
            onChange={(event) => onChange("doj", event.target.value)}
            disabled={isDisabled}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(StepCoreProfile);
