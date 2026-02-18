import React from "react";
import type { EducationInput } from "./types";
import type { FormErrorMap } from "./validation";

type EducationCardProps = {
  education: EducationInput;
  index: number;
  errors: FormErrorMap;
  onChange: (index: number, field: keyof EducationInput, value: string) => void;
  onRemove: (index: number) => void;
  isDisabled: boolean;
};

const EducationCard: React.FC<EducationCardProps> = ({
  education,
  index,
  errors,
  onChange,
  onRemove,
  isDisabled,
}) => {
  const qualificationError = errors[`education.${index}.qualification`];
  const yearError = errors[`education.${index}.year_completed`];

  return (
    <div className="education-item">
      <div
        className={`form-field ${qualificationError ? "invalid" : ""}`}
        data-error={qualificationError ? "true" : undefined}
      >
        <label>Qualification</label>
        <input
          value={education.qualification}
          onChange={(event) =>
            onChange(index, "qualification", event.target.value)
          }
          placeholder="Degree / Certification"
          disabled={isDisabled}
        />
        {qualificationError && (
          <div className="validation-message error">{qualificationError}</div>
        )}
      </div>

      <div className="form-field">
        <label>Specialization</label>
        <input
          value={education.specialization}
          onChange={(event) =>
            onChange(index, "specialization", event.target.value)
          }
          placeholder="Specialization"
          disabled={isDisabled}
        />
      </div>

      <div className="form-field">
        <label>Institution</label>
        <input
          value={education.institution}
          onChange={(event) =>
            onChange(index, "institution", event.target.value)
          }
          placeholder="University / College"
          disabled={isDisabled}
        />
      </div>

      <div
        className={`form-field ${yearError ? "invalid" : ""}`}
        data-error={yearError ? "true" : undefined}
      >
        <label>Year Completed</label>
        <input
          value={education.year_completed}
          onChange={(event) =>
            onChange(index, "year_completed", event.target.value)
          }
          placeholder="YYYY"
          disabled={isDisabled}
        />
        {yearError && (
          <div className="validation-message error">{yearError}</div>
        )}
      </div>

      <div className="education-actions">
        <button
          type="button"
          className="remove-contact-button"
          onClick={() => onRemove(index)}
          disabled={isDisabled}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default React.memo(EducationCard);
