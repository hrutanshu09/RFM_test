import React, { useMemo, useState } from "react";
import { EmployeeContact } from "./types";

const ADDRESS_SEPARATOR = " | ";

const parseAddress = (address?: string | null) => {
  if (!address) {
    return { addressLine: "", city: "", state: "", pincode: "" };
  }
  const parts = address.split(ADDRESS_SEPARATOR).map((part) => part.trim());
  if (parts.length === 4) {
    return {
      addressLine: parts[0] ?? "",
      city: parts[1] ?? "",
      state: parts[2] ?? "",
      pincode: parts[3] ?? "",
    };
  }
  return { addressLine: address, city: "", state: "", pincode: "" };
};

const formatAddress = (fields: {
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
}) => {
  const { addressLine, city, state, pincode } = fields;
  if (!addressLine && !city && !state && !pincode) return "";
  return [addressLine, city, state, pincode]
    .map((part) => part.trim())
    .join(ADDRESS_SEPARATOR);
};

type ContactFormState = {
  phone: string;
  alternatePhone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
};

type ContactDetailsTabProps = {
  contacts: EmployeeContact[];
  onSave: (payload: {
    workContact: EmployeeContact;
    personalContact: EmployeeContact;
  }) => Promise<void>;
  isSaving: boolean;
};

const ContactDetailsTab: React.FC<ContactDetailsTabProps> = ({
  contacts,
  onSave,
  isSaving,
}) => {
  const workContact = contacts.find(
    (contact) => contact.contact_type === "Work",
  );
  const personalContact = contacts.find(
    (contact) => contact.contact_type === "Personal",
  );

  const addressParts = parseAddress(workContact?.address);

  const [formState, setFormState] = useState<ContactFormState>({
    phone: workContact?.phone ?? "",
    alternatePhone: personalContact?.phone ?? "",
    addressLine: addressParts.addressLine,
    city: addressParts.city,
    state: addressParts.state,
    pincode: addressParts.pincode,
  });

  const [error, setError] = useState<string | null>(null);

  const isValid = useMemo(() => {
    return formState.phone.trim().length > 0;
  }, [formState.phone]);

  const handleChange = (field: keyof ContactFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!isValid) {
      setError("Primary phone number is required.");
      return;
    }
    setError(null);
    const address = formatAddress({
      addressLine: formState.addressLine,
      city: formState.city,
      state: formState.state,
      pincode: formState.pincode,
    });

    const baseEmpId = workContact?.emp_id ?? personalContact?.emp_id ?? "";

    await onSave({
      workContact: {
        emp_id: baseEmpId,
        contact_type: "Work",
        email: workContact?.email ?? null,
        phone: formState.phone.trim(),
        address,
      },
      personalContact: {
        emp_id: baseEmpId,
        contact_type: "Personal",
        email: personalContact?.email ?? null,
        phone: formState.alternatePhone.trim(),
        address: personalContact?.address ?? null,
      },
    });
  };

  return (
    <div className="master-data-manager">
      <div className="manager-header">
        <h3>Contact Details</h3>
      </div>

      {error && (
        <div className="tickets-empty-state" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div className="form-field">
        <label>Phone</label>
        <input
          value={formState.phone}
          onChange={(event) => handleChange("phone", event.target.value)}
        />
      </div>

      <div className="form-field">
        <label>Alternate Phone</label>
        <input
          value={formState.alternatePhone}
          onChange={(event) =>
            handleChange("alternatePhone", event.target.value)
          }
        />
      </div>

      <div className="form-field">
        <label>Address</label>
        <input
          value={formState.addressLine}
          onChange={(event) => handleChange("addressLine", event.target.value)}
        />
      </div>

      <div className="form-field">
        <label>City</label>
        <input
          value={formState.city}
          onChange={(event) => handleChange("city", event.target.value)}
        />
      </div>

      <div className="form-field">
        <label>State</label>
        <input
          value={formState.state}
          onChange={(event) => handleChange("state", event.target.value)}
        />
      </div>

      <div className="form-field">
        <label>Pincode</label>
        <input
          value={formState.pincode}
          onChange={(event) => handleChange("pincode", event.target.value)}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="action-button primary"
          onClick={handleSave}
          disabled={isSaving || !isValid}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
};

export default React.memo(ContactDetailsTab);
