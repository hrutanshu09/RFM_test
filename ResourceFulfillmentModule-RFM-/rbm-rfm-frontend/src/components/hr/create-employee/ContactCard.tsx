import React from "react";
import type { ContactInput, ContactType } from "./types";
import type { FormErrorMap } from "./validation";

type ContactCardProps = {
  contact: ContactInput;
  index: number;
  errors: FormErrorMap;
  onChange: (index: number, field: keyof ContactInput, value: string) => void;
  onTypeChange: (index: number, type: ContactType) => void;
  onRemove: (index: number) => void;
  isRemovable: boolean;
  isDisabled: boolean;
};

const ContactCard: React.FC<ContactCardProps> = ({
  contact,
  index,
  errors,
  onChange,
  onTypeChange,
  onRemove,
  isRemovable,
  isDisabled,
}) => {
  const emailError = errors[`contacts.${index}.email`];
  const phoneError = errors[`contacts.${index}.phone`];
  const typeError = errors[`contacts.${index}.type`];

  return (
    <div className="contact-card">
      <div className="contact-card-header">
        <div className="form-field">
          <label>Contact Type</label>
          <select
            value={contact.type}
            onChange={(event) =>
              onTypeChange(index, event.target.value as ContactType)
            }
            disabled={isDisabled}
            data-error={typeError ? "true" : undefined}
          >
            <option value="work">Work</option>
            <option value="personal">Personal</option>
            <option value="emergency">Emergency</option>
          </select>
          {typeError && (
            <div className="validation-message error">{typeError}</div>
          )}
        </div>
        <button
          type="button"
          className="remove-contact-button"
          onClick={() => onRemove(index)}
          disabled={!isRemovable || isDisabled}
        >
          ✕
        </button>
      </div>

      <div className="contact-fields-grid">
        <div
          className={`form-field ${emailError ? "invalid" : ""}`}
          data-error={emailError ? "true" : undefined}
        >
          <label>Email</label>
          <input
            type="email"
            value={contact.email}
            onChange={(event) => onChange(index, "email", event.target.value)}
            placeholder="Email address"
            disabled={isDisabled}
          />
          {emailError && (
            <div className="validation-message error">{emailError}</div>
          )}
        </div>

        <div
          className={`form-field ${phoneError ? "invalid" : ""}`}
          data-error={phoneError ? "true" : undefined}
        >
          <label>Phone</label>
          <input
            value={contact.phone}
            onChange={(event) => onChange(index, "phone", event.target.value)}
            placeholder="Phone number"
            disabled={isDisabled}
          />
          {phoneError && (
            <div className="validation-message error">{phoneError}</div>
          )}
        </div>

        <div className="form-field">
          <label>Address</label>
          <input
            value={contact.address}
            onChange={(event) => onChange(index, "address", event.target.value)}
            placeholder="Address"
            disabled={isDisabled}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(ContactCard);
