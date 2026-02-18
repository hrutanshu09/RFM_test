import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
  CreditCard,
  GraduationCap,
  Phone,
  Search,
  User,
} from "lucide-react";
import { apiClient } from "../../api/client";
import OverviewTab from "./employee-profile/OverviewTab";
import CoreDetailsTab from "./employee-profile/CoreDetailsTab";
import ContactDetailsTab from "./employee-profile/ContactDetailsTab";
import SkillsTab from "./employee-profile/SkillsTab";
import EducationTab from "./employee-profile/EducationTab";
import FinancialTab from "./employee-profile/FinancialTab";
import {
  Assignment,
  Department,
  EmployeeContact,
  EmployeeCore,
  EmployeeDirectoryEntry,
  EmployeeEducation,
  EmployeeFinance,
  EmployeeSkill,
  SkillCatalog,
} from "./employee-profile/types";

type ProfileTab =
  | "overview"
  | "core"
  | "contact"
  | "skills"
  | "education"
  | "financial";

const EmployeeProfile: React.FC = () => {
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");

  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [catalog, setCatalog] = useState<SkillCatalog[]>([]);

  const [employeeCore, setEmployeeCore] = useState<EmployeeCore | null>(null);
  const [contacts, setContacts] = useState<EmployeeContact[]>([]);
  const [skills, setSkills] = useState<EmployeeSkill[]>([]);
  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [finance, setFinance] = useState<EmployeeFinance | null>(null);

  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchEmployees = async () => {
      try {
        setIsLoadingList(true);
        setError(null);

        const [employeesResponse, departmentsResponse, skillsResponse] =
          await Promise.all([
            apiClient.get<
              {
                emp_id: string;
                full_name: string;
                emp_status?: string | null;
                department_name?: string | null;
              }[]
            >("/employees/employees", {
              signal: controller.signal,
            }),
            apiClient.get<Department[]>("/departments/", {
              signal: controller.signal,
            }),
            apiClient.get<SkillCatalog[]>("/skills/", {
              signal: controller.signal,
            }),
          ]);

        if (!isMounted) return;

        setDepartments(departmentsResponse.data ?? []);
        setCatalog(skillsResponse.data ?? []);

        const list = employeesResponse.data ?? [];
        setEmployees(
          list.map((emp) => ({
            emp_id: emp.emp_id,
            full_name: emp.full_name,
            emp_status: emp.emp_status ?? null,
            department_name: emp.department_name ?? null,
          })),
        );
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load employees";
        setError(message);
      } finally {
        if (isMounted) setIsLoadingList(false);
      }
    };

    fetchEmployees();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    let isMounted = true;
    const controller = new AbortController();

    const fetchDetails = async () => {
      try {
        setIsLoadingDetail(true);
        setError(null);

        const safeFinanceRequest = apiClient
          .get<EmployeeFinance>(`/employees/${selectedEmployeeId}/finance/`, {
            signal: controller.signal,
          })
          .catch((err) => {
            const status = (err as { response?: { status?: number } })?.response
              ?.status;
            if (status === 404) {
              return { data: null } as { data: null };
            }
            throw err;
          });

        const [
          employeeResponse,
          contactsResponse,
          skillsResponse,
          educationResponse,
          financeResponse,
          assignmentsResponse,
        ] = await Promise.all([
          apiClient.get<EmployeeCore>(`/employees/${selectedEmployeeId}`, {
            signal: controller.signal,
          }),
          apiClient.get<EmployeeContact[]>(
            `/employees/${selectedEmployeeId}/contacts/`,
            { signal: controller.signal },
          ),
          apiClient.get<EmployeeSkill[]>(
            `/employees/${selectedEmployeeId}/skills/`,
            { signal: controller.signal },
          ),
          apiClient.get<EmployeeEducation[]>(
            `/employees/${selectedEmployeeId}/education/`,
            { signal: controller.signal },
          ),
          safeFinanceRequest,
          apiClient.get<Assignment[]>(
            `/employees/${selectedEmployeeId}/assignments`,
            { signal: controller.signal },
          ),
        ]);

        if (!isMounted) return;

        setEmployeeCore(employeeResponse.data);
        setContacts(contactsResponse.data ?? []);
        setSkills(skillsResponse.data ?? []);
        setEducation(educationResponse.data ?? []);
        setFinance(financeResponse.data ?? null);

        const assignments = assignmentsResponse.data ?? [];
        const latest = assignments[0];
        if (latest) {
          const departmentName =
            departments.find(
              (dept) => dept.department_id === latest.department_id,
            )?.department_name ?? null;
          setEmployees((prev) =>
            prev.map((emp) =>
              emp.emp_id === selectedEmployeeId
                ? { ...emp, department_name: departmentName }
                : emp,
            ),
          );
        }
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load profile";
        setError(message);
      } finally {
        if (isMounted) setIsLoadingDetail(false);
      }
    };

    fetchDetails();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedEmployeeId, departments]);

  const filteredEmployees = useMemo(() => {
    const query = search.toLowerCase();
    return employees.filter((employee) =>
      [employee.full_name, employee.emp_id, employee.rbm_email]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [employees, search]);

  const tabs: { id: ProfileTab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <User size={14} /> },
    { id: "core", label: "Core Details", icon: <User size={14} /> },
    { id: "contact", label: "Contact Details", icon: <Phone size={14} /> },
    { id: "skills", label: "Skills", icon: <Award size={14} /> },
    { id: "education", label: "Education", icon: <GraduationCap size={14} /> },
    { id: "financial", label: "Financial", icon: <CreditCard size={14} /> },
  ];

  if (!selectedEmployeeId) {
    return (
      <>
        <div className="log-filters">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Search by name, employee ID, or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="employee-profile-grid">
          {isLoadingList && (
            <div className="empty-state">Loading employees…</div>
          )}

          {!isLoadingList && error && (
            <div className="empty-state" style={{ color: "var(--error)" }}>
              {error}
            </div>
          )}

          {!isLoadingList &&
            !error &&
            filteredEmployees.map((employee) => (
              <div
                key={employee.emp_id}
                className="stat-card employee-card"
                onClick={() => {
                  setSelectedEmployeeId(employee.emp_id);
                  setActiveTab("overview");
                }}
              >
                <div className="employee-card-title">{employee.full_name}</div>
                <div className="text-xs text-slate-500">{employee.emp_id}</div>

                <div className="employee-card-meta">
                  <div>
                    <strong>Status:</strong> {employee.emp_status ?? "—"}
                  </div>
                  <div>
                    <strong>Dept:</strong> {employee.department_name ?? "—"}
                  </div>
                </div>
              </div>
            ))}

          {!isLoadingList && !error && filteredEmployees.length === 0 && (
            <div className="empty-state">No employees match your search.</div>
          )}
        </div>
      </>
    );
  }

  const selectedDirectory = employees.find(
    (entry) => entry.emp_id === selectedEmployeeId,
  );

  const handleCoreSave = async (payload: {
    full_name: string;
    doj?: string | null;
    status: string;
  }) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.patch(`/employees/${employeeCore.emp_id}`, {
        full_name: payload.full_name,
        doj: payload.doj,
      });
      if (payload.status !== employeeCore.emp_status) {
        await apiClient.patch(`/employees/${employeeCore.emp_id}/status`, {
          emp_status: payload.status,
        });
      }
      setEmployeeCore({
        ...employeeCore,
        full_name: payload.full_name,
        doj: payload.doj ?? null,
        emp_status: payload.status,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleContactSave = async (payload: {
    workContact: EmployeeContact;
    personalContact: EmployeeContact;
  }) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.post(`/employees/${employeeCore.emp_id}/contacts/`, {
        contact_type: payload.workContact.contact_type,
        email: payload.workContact.email,
        phone: payload.workContact.phone,
        address: payload.workContact.address,
      });
      await apiClient.post(`/employees/${employeeCore.emp_id}/contacts/`, {
        contact_type: payload.personalContact.contact_type,
        email: payload.personalContact.email,
        phone: payload.personalContact.phone,
        address: payload.personalContact.address,
      });
      setContacts([payload.workContact, payload.personalContact]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkillAdd = async (payload: {
    skill_id: number;
    proficiency_level: string;
    years_experience: number;
  }) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.post(
        `/employees/${employeeCore.emp_id}/skills/`,
        payload,
      );
      const response = await apiClient.get<EmployeeSkill[]>(
        `/employees/${employeeCore.emp_id}/skills/`,
      );
      setSkills(response.data ?? []);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkillRemove = async (skillId: number) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.delete(
        `/employees/${employeeCore.emp_id}/skills/${skillId}`,
      );
      setSkills((prev) => prev.filter((item) => item.skill_id !== skillId));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEducationAdd = async (payload: {
    qualification: string;
    specialization?: string | null;
    institution?: string | null;
    year_completed?: number | null;
  }) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.post(
        `/employees/${employeeCore.emp_id}/education/`,
        payload,
      );
      const response = await apiClient.get<EmployeeEducation[]>(
        `/employees/${employeeCore.emp_id}/education/`,
      );
      setEducation(response.data ?? []);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEducationUpdate = async (
    eduId: number,
    payload: Partial<EmployeeEducation>,
  ) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.patch(
        `/employees/${employeeCore.emp_id}/education/${eduId}`,
        payload,
      );
      const response = await apiClient.get<EmployeeEducation[]>(
        `/employees/${employeeCore.emp_id}/education/`,
      );
      setEducation(response.data ?? []);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEducationDelete = async (eduId: number) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      await apiClient.delete(
        `/employees/${employeeCore.emp_id}/education/${eduId}`,
      );
      setEducation((prev) => prev.filter((item) => item.edu_id !== eduId));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinanceSave = async (payload: {
    bank_details: string;
    tax_id: string;
  }) => {
    if (!employeeCore) return;
    setIsSaving(true);
    try {
      const response = await apiClient.post<EmployeeFinance>(
        `/employees/${employeeCore.emp_id}/finance/`,
        payload,
      );
      setFinance(response.data);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        className="action-button"
        style={{ marginBottom: "16px" }}
        onClick={() => setSelectedEmployeeId(null)}
      >
        <ArrowLeft size={14} />
        Back to Employee List
      </button>

      <div className="manager-header">
        <h2>{employeeCore?.full_name ?? selectedEmployeeId}</h2>
        <p className="subtitle">{employeeCore?.emp_id ?? selectedEmployeeId}</p>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`control-button ${
              activeTab === tab.id ? "primary" : ""
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="tickets-empty-state" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}

      {isLoadingDetail || !employeeCore ? (
        <div className="tickets-empty-state">Loading employee profile…</div>
      ) : (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              employee={employeeCore}
              departmentName={selectedDirectory?.department_name ?? "—"}
              contactsComplete={contacts.length > 0}
              hasSkills={skills.length > 0}
              hasEducation={education.length > 0}
              hasFinance={Boolean(finance)}
            />
          )}
          {activeTab === "core" && (
            <CoreDetailsTab
              employee={employeeCore}
              onSave={handleCoreSave}
              isSaving={isSaving}
            />
          )}
          {activeTab === "contact" && (
            <ContactDetailsTab
              contacts={contacts}
              onSave={handleContactSave}
              isSaving={isSaving}
            />
          )}
          {activeTab === "skills" && (
            <SkillsTab
              skills={skills}
              catalog={catalog}
              onAdd={handleSkillAdd}
              onRemove={handleSkillRemove}
              isSaving={isSaving}
            />
          )}
          {activeTab === "education" && (
            <EducationTab
              education={education}
              onAdd={handleEducationAdd}
              onUpdate={handleEducationUpdate}
              onDelete={handleEducationDelete}
              isSaving={isSaving}
            />
          )}
          {activeTab === "financial" && (
            <FinancialTab
              finance={finance}
              onSave={handleFinanceSave}
              isSaving={isSaving}
            />
          )}
        </>
      )}
    </>
  );
};

export default EmployeeProfile;
