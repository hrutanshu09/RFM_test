import React, { useMemo, useState } from "react";
import { EmployeeCore } from "./types";

const STATUS_OPTIONS = ["Onboarding", "Active", "On Leave", "Exited"] as const;

type CoreDetailsTabProps = {
  employee: EmployeeCore;
  onSave: (payload: {
    full_name: string;
    doj?: string | null;
    status: string;
  }) => Promise<void>;
  isSaving: boolean;
};

const CoreDetailsTab: React.FC<CoreDetailsTabProps> = ({
  employee,
  onSave,
  isSaving,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(employee.full_name);
  const [doj, setDoj] = useState(employee.doj ?? "");
  const [status, setStatus] = useState(employee.emp_status);
  const [error, setError] = useState<string | null>(null);

  const isValid = useMemo(() => fullName.trim().length > 0, [fullName]);

  const handleCancel = () => {
    setIsEditing(false);
    setFullName(employee.full_name);
    setDoj(employee.doj ?? "");
    setStatus(employee.emp_status);
    setError(null);
  };

  const handleSave = async () => {
    if (!isValid) {
      setError("Full name is required.");
      return;
    }
    setError(null);
    await onSave({
      full_name: fullName.trim(),
      doj: doj || null,
      status,
    });
    setIsEditing(false);
  };

  return (
    <div className="master-data-manager">
      <div className="manager-header">
        <h3>Core Details</h3>
      </div>

      {error && (
        <div className="tickets-empty-state" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div className="form-field">
        <label>Employee ID</label>
        <input value={employee.emp_id} disabled />
      </div>

      <div className="form-field">
        <label>Full Name</label>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div className="form-field">
        <label>Email</label>
        <input value={employee.rbm_email} disabled />
      </div>

      <div className="form-field">
        <label>Date of Joining</label>
        <input
          type="date"
          value={doj}
          onChange={(event) => setDoj(event.target.value)}
          disabled={!isEditing}
        />
      </div>

      <div className="form-field">
        <label>Status</label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          disabled={!isEditing}
        >
          {STATUS_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
        {!isEditing ? (
          <button
            className="action-button primary"
            onClick={() => setIsEditing(true)}
          >
            Edit Core Details
          </button>
        ) : (
          <>
            <button
              className="action-button"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              className="action-button primary"
              onClick={handleSave}
              disabled={isSaving || !isValid}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(CoreDetailsTab);
