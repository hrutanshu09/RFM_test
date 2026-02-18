import React, { useMemo, useState } from "react";
import { EmployeeSkill, SkillCatalog } from "./types";

const UI_LEVELS = [
  { label: "Beginner", value: "Junior" },
  { label: "Intermediate", value: "Mid" },
  { label: "Expert", value: "Senior" },
] as const;

type SkillsTabProps = {
  skills: EmployeeSkill[];
  catalog: SkillCatalog[];
  onAdd: (payload: {
    skill_id: number;
    proficiency_level: string;
    years_experience: number;
  }) => Promise<void>;
  onRemove: (skillId: number) => Promise<void>;
  isSaving: boolean;
};

const SkillsTab: React.FC<SkillsTabProps> = ({
  skills,
  catalog,
  onAdd,
  onRemove,
  isSaving,
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [level, setLevel] = useState<string>(UI_LEVELS[0].value);
  const [years, setYears] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const availableOptions = useMemo(() => {
    const taken = new Set(skills.map((skill) => skill.skill_id));
    return catalog.filter((skill) => !taken.has(skill.skill_id));
  }, [catalog, skills]);

  const getSkillName = (skillId: number) =>
    catalog.find((skill) => skill.skill_id === skillId)?.skill_name ??
    `Skill #${skillId}`;

  const handleAdd = async () => {
    if (!selectedSkillId) {
      setError("Select a skill to add.");
      return;
    }
    setError(null);
    await onAdd({
      skill_id: Number(selectedSkillId),
      proficiency_level: level,
      years_experience: Number(years) || 0,
    });
    setSelectedSkillId("");
    setYears("1");
  };

  return (
    <div className="master-data-manager">
      <div className="manager-header">
        <h3>Skills</h3>
      </div>

      {error && (
        <div className="tickets-empty-state" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div className="skill-tags">
        {skills.length === 0 && (
          <div className="tickets-empty-state">No skills added yet.</div>
        )}
        {skills.map((skill) => (
          <div key={skill.skill_id} className="skill-item">
            <div>
              <strong>{getSkillName(skill.skill_id)}</strong>
              <div className="text-xs text-slate-500">
                {skill.proficiency_level ?? "—"} • {skill.years_experience ?? 0}
                y
              </div>
            </div>
            <button
              className="remove-contact-button"
              type="button"
              onClick={() => onRemove(skill.skill_id)}
              disabled={isSaving}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="form-field">
        <label>Add Skill</label>
        <select
          value={selectedSkillId}
          onChange={(event) => setSelectedSkillId(event.target.value)}
        >
          <option value="">Select skill</option>
          {availableOptions.map((skill) => (
            <option key={skill.skill_id} value={skill.skill_id}>
              {skill.skill_name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label>Skill Level</label>
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value)}
        >
          {UI_LEVELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label>Years of Experience</label>
        <input
          type="number"
          min={0}
          max={50}
          value={years}
          onChange={(event) => setYears(event.target.value)}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="action-button primary"
          type="button"
          onClick={handleAdd}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Add Skill"}
        </button>
      </div>
    </div>
  );
};

export default React.memo(SkillsTab);
