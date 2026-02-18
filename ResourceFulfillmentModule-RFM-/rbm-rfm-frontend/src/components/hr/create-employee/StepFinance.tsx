import React from "react";
import type { CreateEmployeeForm } from "./types";
import type { FormErrorMap } from "./validation";

type StepFinanceProps = {
  formData: CreateEmployeeForm;
  errors: FormErrorMap;
  onChange: (field: keyof CreateEmployeeForm["finance"], value: string) => void;
  isDisabled: boolean;
};

const StepFinance: React.FC<StepFinanceProps> = ({
  formData,
  errors,
  onChange,
  isDisabled,
}) => {
  const finance = formData.finance;
  return (
    <div className="section-content">
      <div className="secure-section">
        <div className="secure-banner">Restricted • HR Only</div>

        <div className="form-grid">
          <div className="form-field">
            <label>Bank Details</label>
            <input
              type="password"
              value={finance.bankDetails}
              onChange={(event) => onChange("bankDetails", event.target.value)}
              placeholder="Account details"
              disabled={isDisabled}
            />
            {errors["finance.bankDetails"] && (
              <div className="validation-message error">
                {errors["finance.bankDetails"]}
              </div>
            )}
          </div>

          <div className="form-field">
            <label>Tax ID</label>
            <input
              type="password"
              value={finance.taxId}
              onChange={(event) => onChange("taxId", event.target.value)}
              placeholder="Tax identification"
              disabled={isDisabled}
            />
            {errors["finance.taxId"] && (
              <div className="validation-message error">
                {errors["finance.taxId"]}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(StepFinance);
