import React from "react";

import ContactCard from "./ContactCard";
import EducationCard from "./EducationCard";
import SkillSelector from "./SkillSelector";
import type {
  ContactInput,
  CreateEmployeeForm,
  EducationInput,
  SkillInput,
  SkillOption,
} from "./types";
import type { FormErrorMap } from "./validation";

type StepSkillsContactsProps = {
  formData: CreateEmployeeForm;
  skillsCatalog: SkillOption[];
  errors: FormErrorMap;
  onContactsChange: (contacts: ContactInput[]) => void;
  onSkillsChange: (skills: SkillInput[]) => void;
  onEducationChange: (education: EducationInput[]) => void;
  isDisabled: boolean;
};

const StepSkillsContacts: React.FC<StepSkillsContactsProps> = ({
  formData,
  skillsCatalog,
  errors,
  onContactsChange,
  onSkillsChange,
  onEducationChange,
  isDisabled,
}) => {
  const handleContactFieldChange = (
    index: number,
    field: keyof ContactInput,
    value: string,
  ) => {
    const updated = [...formData.contacts];
    const current = updated[index] ?? {
      type: "work",
      email: "",
      phone: "",
      address: "",
    };
    updated[index] = { ...current, [field]: value };
    onContactsChange(updated);
  };

  const handleContactTypeChange = (
    index: number,
    type: ContactInput["type"],
  ) => {
    const updated = [...formData.contacts];
    const current = updated[index] ?? {
      type: "work",
      email: "",
      phone: "",
      address: "",
    };
    updated[index] = { ...current, type };
    onContactsChange(updated);
  };

  const handleContactRemove = (index: number) => {
    const updated = formData.contacts.filter((_, idx) => idx !== index);
    onContactsChange(updated);
  };

  const canRemoveContact = (contact: ContactInput) => {
    if (contact.type !== "work") {
      return true;
    }
    const workCount = formData.contacts.filter(
      (item) => item.type === "work",
    ).length;
    return workCount > 1;
  };

  const handleSkillAdd = (payload: SkillInput) => {
    onSkillsChange([...formData.skills, payload]);
  };

  const handleSkillRemove = (skillId: number) => {
    onSkillsChange(
      formData.skills.filter((skill) => skill.skill_id !== skillId),
    );
  };

  const handleEducationChange = (
    index: number,
    field: keyof EducationInput,
    value: string,
  ) => {
    const updated = [...formData.education];
    const current = updated[index] ?? {
      qualification: "",
      specialization: "",
      institution: "",
      year_completed: "",
    };
    updated[index] = { ...current, [field]: value };
    onEducationChange(updated);
  };

  const handleEducationRemove = (index: number) => {
    onEducationChange(formData.education.filter((_, idx) => idx !== index));
  };

  return (
    <div className="section-content">
      <div className="skills-matrix">
        <h3>Skills</h3>
        <SkillSelector
          catalog={skillsCatalog}
          selectedSkills={formData.skills}
          onAdd={handleSkillAdd}
          isDisabled={isDisabled}
        />

        {formData.skills.length === 0 && (
          <div className="skills-loading">No skills added yet.</div>
        )}

        {formData.skills.map((skill) => (
          <div key={skill.skill_id} className="skill-item">
            <div>
              <strong>
                {skillsCatalog.find((item) => item.skill_id === skill.skill_id)
                  ?.skill_name ?? `Skill #${skill.skill_id}`}
              </strong>
            </div>
            <div>{skill.proficiency_level}</div>
            <div>{skill.years_experience} years</div>
            <button
              type="button"
              className="remove-contact-button"
              onClick={() => handleSkillRemove(skill.skill_id)}
              disabled={isDisabled}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="section-divider" />

      <div className="contact-section">
        <div className="section-header-row">
          <h3>Contacts</h3>
          <button
            type="button"
            className="add-item-button"
            onClick={() =>
              onContactsChange([
                ...formData.contacts,
                { type: "personal", email: "", phone: "", address: "" },
              ])
            }
            disabled={isDisabled}
          >
            Add Contact
          </button>
        </div>

        <div className="contact-list">
          {formData.contacts.map((contact, index) => (
            <ContactCard
              key={`${contact.type}-${index}`}
              contact={contact}
              index={index}
              errors={errors}
              onChange={handleContactFieldChange}
              onTypeChange={handleContactTypeChange}
              onRemove={handleContactRemove}
              isRemovable={canRemoveContact(contact)}
              isDisabled={isDisabled}
            />
          ))}
        </div>
      </div>

      <div className="section-divider" />

      <div className="education-section">
        <div className="section-header-row">
          <h3>Education</h3>
          <button
            type="button"
            className="add-item-button"
            onClick={() =>
              onEducationChange([
                ...formData.education,
                {
                  qualification: "",
                  specialization: "",
                  institution: "",
                  year_completed: "",
                },
              ])
            }
            disabled={isDisabled}
          >
            Add Education
          </button>
        </div>

        {formData.education.length === 0 && (
          <div className="education-empty">
            <p>No education entries added yet.</p>
          </div>
        )}

        <div className="education-list">
          {formData.education.map((edu, index) => (
            <EducationCard
              key={`education-${index}`}
              education={edu}
              index={index}
              errors={errors}
              onChange={handleEducationChange}
              onRemove={handleEducationRemove}
              isDisabled={isDisabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(StepSkillsContacts);
