import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";

/* ======================================================
   Types
   ====================================================== */

interface Resource {
  empId: string;
  name: string;
  skills: {
    name: string;
    level: "Junior" | "Mid" | "Senior";
    experience: number;
  }[];
  availabilityPct?: number | null;
}

/* ======================================================
   Component
   ====================================================== */

const ResourcePool: React.FC = () => {
  const [skillFilter, setSkillFilter] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchResources = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [employeesRes, skillsRes] = await Promise.all([
          apiClient.get<{ emp_id: string; full_name: string }[]>(
            "/employees/employees",
            { signal: controller.signal },
          ),
          apiClient.get<{ skill_id: number; skill_name: string }[]>(
            "/skills/",
            { signal: controller.signal },
          ),
        ]);

        const skillsById = new Map<number, string>(
          (skillsRes.data ?? []).map((skill) => [
            skill.skill_id,
            skill.skill_name,
          ]),
        );

        const employees = employeesRes.data ?? [];

        const resourceList = await Promise.all(
          employees.map(async (emp) => {
            const [skillsResp, availabilityResp] = await Promise.all([
              apiClient.get<
                {
                  skill_id: number;
                  proficiency_level?: "Junior" | "Mid" | "Senior" | null;
                  years_experience?: number | null;
                }[]
              >(`/employees/${emp.emp_id}/skills/`, {
                signal: controller.signal,
              }),
              apiClient
                .get<
                  {
                    availability_pct: number;
                    effective_from: string;
                  }[]
                >(`/employees/${emp.emp_id}/availability`, {
                  signal: controller.signal,
                })
                .catch(() => ({ data: [] })),
            ]);

            const skills = (skillsResp.data ?? []).map((skill) => ({
              name:
                skillsById.get(skill.skill_id) ?? `Skill #${skill.skill_id}`,
              level: (skill.proficiency_level ?? "Junior") as
                | "Junior"
                | "Mid"
                | "Senior",
              experience: Number(skill.years_experience ?? 0),
            }));

            const availabilityHistory = availabilityResp.data ?? [];
            const latestAvailability = availabilityHistory
              .slice()
              .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
              .slice(-1)[0];

            return {
              empId: emp.emp_id,
              name: emp.full_name,
              skills,
              availabilityPct: latestAvailability?.availability_pct ?? null,
            } as Resource;
          }),
        );

        if (!isMounted) return;
        setResources(resourceList);
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load resources";
        setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchResources();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const filteredResources = useMemo(() => {
    const query = skillFilter.trim().toLowerCase();
    if (!query) return resources;
    return resources.filter((res) =>
      res.skills.some((s) => s.name.toLowerCase().includes(query)),
    );
  }, [resources, skillFilter]);

  return (
    <>
      {/* Header */}
      <div className="manager-header">
        <h2>Internal Resource Pool</h2>
        <p className="subtitle">
          Read-only view of active & available employees
        </p>
      </div>

      {/* Filters */}
      <div className="log-filters">
        <div className="filter-grid">
          <div className="filter-item">
            <label>Skill</label>
            <input
              type="text"
              placeholder="Search by skill (e.g. React)"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Resource Table */}
      <div className="ticket-table-container">
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Skills</th>
              <th>Availability</th>
            </tr>
          </thead>

          <tbody>
            {filteredResources.map((res) => (
              <tr key={res.empId}>
                <td>
                  <strong>{res.name}</strong>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {res.empId}
                  </div>
                </td>

                <td>
                  {res.skills.map((skill) => (
                    <div key={skill.name}>
                      <strong>{skill.name}</strong>{" "}
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        ({skill.level}, {skill.experience}y)
                      </span>
                    </div>
                  ))}
                </td>

                <td>
                  {res.availabilityPct === null ||
                  res.availabilityPct === undefined ? (
                    "—"
                  ) : (
                    <span
                      className={`status-badge ${
                        res.availabilityPct >= 80 ? "active" : "inactive"
                      }`}
                    >
                      {res.availabilityPct}%
                    </span>
                  )}
                </td>
              </tr>
            ))}

            {!isLoading && !error && filteredResources.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div className="tickets-empty-state">
                    No matching resources found
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {isLoading && (
          <div className="tickets-empty-state" style={{ paddingTop: "16px" }}>
            Loading resources…
          </div>
        )}

        {!isLoading && error && (
          <div
            className="tickets-empty-state"
            style={{ color: "var(--error)", paddingTop: "16px" }}
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
};

export default ResourcePool;
