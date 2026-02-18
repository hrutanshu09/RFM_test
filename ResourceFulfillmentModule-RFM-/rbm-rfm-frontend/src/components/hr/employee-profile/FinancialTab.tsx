import React, { useMemo, useState } from "react";
import { EmployeeFinance } from "./types";

type FinancialTabProps = {
  finance: EmployeeFinance | null;
  onSave: (payload: { bank_details: string; tax_id: string }) => Promise<void>;
  isSaving: boolean;
};

type BankDetails = {
  bankName: string;
  accountNumber: string;
  ifsc: string;
};

const parseBankDetails = (value?: string | null): BankDetails => {
  if (!value) return { bankName: "", accountNumber: "", ifsc: "" };
  try {
    const parsed = JSON.parse(value) as BankDetails;
    return {
      bankName: parsed.bankName ?? "",
      accountNumber: parsed.accountNumber ?? "",
      ifsc: parsed.ifsc ?? "",
    };
  } catch {
    return { bankName: value, accountNumber: "", ifsc: "" };
  }
};

const maskValue = (value: string) => {
  if (value.length <= 4) return value;
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

const FinancialTab: React.FC<FinancialTabProps> = ({
  finance,
  onSave,
  isSaving,
}) => {
  const initial = useMemo(
    () => parseBankDetails(finance?.bank_details),
    [finance?.bank_details],
  );

  const [bankName, setBankName] = useState(initial.bankName);
  const [accountNumber, setAccountNumber] = useState(initial.accountNumber);
  const [ifsc, setIfsc] = useState(initial.ifsc);
  const [pan, setPan] = useState(finance?.tax_id ?? "");
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = async () => {
    const payload = {
      bank_details: JSON.stringify({ bankName, accountNumber, ifsc }),
      tax_id: pan,
    };
    await onSave(payload);
    setIsEditing(false);
  };

  return (
    <div className="master-data-manager">
      <div className="manager-header">
        <h3>Financial Details</h3>
      </div>

      <div className="form-field">
        <label>Bank Name</label>
        <input
          value={isEditing ? bankName : bankName || "—"}
          onChange={(event) => setBankName(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div className="form-field">
        <label>Account Number</label>
        <input
          value={isEditing ? accountNumber : maskValue(accountNumber || "—")}
          onChange={(event) => setAccountNumber(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div className="form-field">
        <label>IFSC Code</label>
        <input
          value={isEditing ? ifsc : ifsc || "—"}
          onChange={(event) => setIfsc(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div className="form-field">
        <label>PAN</label>
        <input
          value={isEditing ? pan : maskValue(pan || "—")}
          onChange={(event) => setPan(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
        {!isEditing ? (
          <button
            className="action-button primary"
            type="button"
            onClick={() => setIsEditing(true)}
          >
            Edit Financial Details
          </button>
        ) : (
          <>
            <button
              className="action-button"
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              className="action-button primary"
              type="button"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(FinancialTab);
