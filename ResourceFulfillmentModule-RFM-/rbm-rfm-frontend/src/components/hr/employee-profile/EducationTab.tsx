import React, { useState } from "react";
import { EmployeeEducation } from "./types";

type EducationTabProps = {
  education: EmployeeEducation[];
  onAdd: (payload: {
    qualification: string;
    specialization?: string | null;
    institution?: string | null;
    year_completed?: number | null;
  }) => Promise<void>;
  onUpdate: (
    eduId: number,
    payload: Partial<EmployeeEducation>,
  ) => Promise<void>;
  onDelete: (eduId: number) => Promise<void>;
  isSaving: boolean;
};

const EducationTab: React.FC<EducationTabProps> = ({
  education,
  onAdd,
  onUpdate,
  onDelete,
  isSaving,
}) => {
  const [formState, setFormState] = useState({
    qualification: "",
    specialization: "",
    institution: "",
    year_completed: "",
  });

  const handleAdd = async () => {
    if (!formState.qualification.trim()) return;
    await onAdd({
      qualification: formState.qualification.trim(),
      specialization: formState.specialization.trim() || null,
      institution: formState.institution.trim() || null,
      year_completed: formState.year_completed
        ? Number(formState.year_completed)
        : null,
    });
    setFormState({
      qualification: "",
      specialization: "",
      institution: "",
      year_completed: "",
    });
  };

  return (
    <div className="master-data-manager">
      <div className="manager-header">
        <h3>Education</h3>
      </div>

      {education.length === 0 && (
        <div className="tickets-empty-state">No education records found.</div>
      )}

      <div className="education-list">
        {education.map((edu) => (
          <div key={edu.edu_id} className="stat-card">
            <div style={{ fontWeight: 600 }}>{edu.qualification}</div>
            <div className="text-xs text-slate-500">
              {edu.institution ?? "—"} • {edu.year_completed ?? "—"}
            </div>
            <div style={{ marginTop: "12px" }}>
              <input
                className="form-field"
                value={edu.specialization ?? ""}
                onChange={(event) =>
                  onUpdate(edu.edu_id, { specialization: event.target.value })
                }
                placeholder="Specialization"
                disabled={isSaving}
              />
            </div>
            <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
              <button
                className="action-button"
                type="button"
                onClick={() => onDelete(edu.edu_id)}
                disabled={isSaving}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="form-field">
        <label>Degree</label>
        <input
          value={formState.qualification}
          onChange={(event) =>
            setFormState((prev) => ({
              ...prev,
              qualification: event.target.value,
            }))
          }
        />
      </div>

      <div className="form-field">
        <label>Institution</label>
        <input
          value={formState.institution}
          onChange={(event) =>
            setFormState((prev) => ({
              ...prev,
              institution: event.target.value,
            }))
          }
        />
      </div>

      <div className="form-field">
        <label>Year</label>
        <input
          value={formState.year_completed}
          onChange={(event) =>
            setFormState((prev) => ({
              ...prev,
              year_completed: event.target.value,
            }))
          }
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="action-button primary"
          type="button"
          onClick={handleAdd}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Add Education"}
        </button>
      </div>
    </div>
  );
};

export default React.memo(EducationTab);
