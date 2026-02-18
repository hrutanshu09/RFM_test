import React from "react";
import type {
  CreateEmployeeForm,
  LocationOption,
  ManagerOption,
} from "./types";
import type { FormErrorMap } from "./validation";

type StepDeploymentProps = {
  formData: CreateEmployeeForm;
  locations: LocationOption[];
  managers: ManagerOption[];
  errors: FormErrorMap;
  onChange: (
    field: keyof CreateEmployeeForm["deployment"],
    value: string | number,
  ) => void;
  isDisabled: boolean;
};

const StepDeployment: React.FC<StepDeploymentProps> = ({
  formData,
  locations,
  managers,
  errors,
  onChange,
  isDisabled,
}) => {
  const deployment = formData.deployment;
  return (
    <div className="section-content">
      <div className="form-grid">
        <div
          className={`form-field ${
            errors["deployment.availabilityPct"] ? "invalid" : ""
          }`}
          data-error={errors["deployment.availabilityPct"] ? "true" : undefined}
        >
          <label>Availability (%)</label>
          <div className="range-input">
            <input
              type="range"
              min={0}
              max={100}
              value={deployment.availabilityPct}
              onChange={(event) =>
                onChange("availabilityPct", Number(event.target.value))
              }
              disabled={isDisabled}
            />
            <span className="range-value">{deployment.availabilityPct}%</span>
          </div>
          {errors["deployment.availabilityPct"] && (
            <div className="validation-message error">
              {errors["deployment.availabilityPct"]}
            </div>
          )}
        </div>

        <div
          className={`form-field ${
            errors["deployment.effectiveFrom"] ? "invalid" : ""
          }`}
          data-error={errors["deployment.effectiveFrom"] ? "true" : undefined}
        >
          <label>Effective From</label>
          <input
            type="date"
            value={deployment.effectiveFrom}
            onChange={(event) => onChange("effectiveFrom", event.target.value)}
            disabled={isDisabled}
          />
          {errors["deployment.effectiveFrom"] && (
            <div className="validation-message error">
              {errors["deployment.effectiveFrom"]}
            </div>
          )}
        </div>

        <div className="form-field">
          <label>Reporting Manager</label>
          <select
            value={deployment.managerId}
            onChange={(event) => onChange("managerId", event.target.value)}
            disabled={isDisabled}
          >
            <option value="">Select manager</option>
            {managers.map((manager) => (
              <option key={manager.emp_id} value={manager.emp_id}>
                {manager.full_name} ({manager.emp_id})
              </option>
            ))}
          </select>
        </div>

        <div
          className={`form-field ${
            errors["deployment.locationId"] ? "invalid" : ""
          }`}
          data-error={errors["deployment.locationId"] ? "true" : undefined}
        >
          <label>Work Location</label>
          <select
            value={deployment.locationId}
            onChange={(event) => onChange("locationId", event.target.value)}
            disabled={isDisabled}
          >
            <option value="">Select location</option>
            {locations.map((loc) => (
              <option key={loc.location_id} value={loc.location_id}>
                {[loc.city, loc.country].filter(Boolean).join(", ") || "—"}
              </option>
            ))}
          </select>
          {errors["deployment.locationId"] && (
            <div className="validation-message error">
              {errors["deployment.locationId"]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(StepDeployment);
