import React, { useMemo, useState } from "react";
import type { ProficiencyLevel, SkillInput, SkillOption } from "./types";

const LEVELS: { label: string; value: ProficiencyLevel }[] = [
  { label: "Junior", value: "Junior" },
  { label: "Mid", value: "Mid" },
  { label: "Senior", value: "Senior" },
];

type SkillSelectorProps = {
  catalog: SkillOption[];
  selectedSkills: SkillInput[];
  onAdd: (payload: SkillInput) => void;
  isDisabled: boolean;
};

const SkillSelector: React.FC<SkillSelectorProps> = ({
  catalog,
  selectedSkills,
  onAdd,
  isDisabled,
}) => {
  const [search, setSearch] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [level, setLevel] = useState<ProficiencyLevel>("Junior");
  const [years, setYears] = useState("1");

  const availableSkills = useMemo(() => {
    const taken = new Set(selectedSkills.map((skill) => skill.skill_id));
    return catalog.filter((skill) => !taken.has(skill.skill_id));
  }, [catalog, selectedSkills]);

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableSkills;
    return availableSkills.filter((skill) =>
      skill.skill_name.toLowerCase().includes(query),
    );
  }, [availableSkills, search]);

  const handleAdd = () => {
    if (!selectedSkillId) return;
    onAdd({
      skill_id: selectedSkillId,
      proficiency_level: level,
      years_experience: Number(years) || 0,
    });
    setSelectedSkillId(null);
    setSearch("");
    setYears("1");
  };

  return (
    <div className="skill-selector">
      <div className="form-field">
        <label>Skill Search</label>
        <div className="searchable-dropdown">
          <input
            placeholder="Search skills"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={isDisabled}
          />
          {filteredOptions.length > 0 && (
            <div className="dropdown-options">
              {filteredOptions.map((skill) => (
                <button
                  key={skill.skill_id}
                  type="button"
                  className={`dropdown-option ${
                    selectedSkillId === skill.skill_id ? "selected" : ""
                  }`}
                  onClick={() => setSelectedSkillId(skill.skill_id)}
                  disabled={isDisabled}
                >
                  <span>{skill.skill_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <label>Selected Skill</label>
          <select
            value={selectedSkillId ?? ""}
            onChange={(event) =>
              setSelectedSkillId(
                event.target.value ? Number(event.target.value) : null,
              )
            }
            disabled={isDisabled}
          >
            <option value="">Select a skill</option>
            {availableSkills.map((skill) => (
              <option key={skill.skill_id} value={skill.skill_id}>
                {skill.skill_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Proficiency</label>
          <select
            value={level}
            onChange={(event) =>
              setLevel(event.target.value as ProficiencyLevel)
            }
            disabled={isDisabled}
          >
            {LEVELS.map((item) => (
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
            disabled={isDisabled}
          />
        </div>
      </div>

      <div className="skill-action-row">
        <button
          type="button"
          className="add-item-button"
          onClick={handleAdd}
          disabled={isDisabled || !selectedSkillId}
        >
          Add Skill
        </button>
      </div>
    </div>
  );
};

export default React.memo(SkillSelector);
