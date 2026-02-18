// components/hr/SkillsOverview.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";

interface SkillCapability {
  skillId: number;
  skillName: string;
  totalEmployees: number;
  proficiency: {
    junior: number;
    mid: number;
    senior: number;
  };
}

const SkillsOverview: React.FC = () => {
  const [skillsData, setSkillsData] = useState<SkillCapability[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchSkills = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await apiClient.get<
          {
            skill_id: number;
            skill_name: string;
            total_employees: number;
            proficiency: {
              junior: number;
              mid: number;
              senior: number;
            };
          }[]
        >("/hr/skills-summary", { signal: controller.signal });

        if (!isMounted) return;
        const rows = response.data ?? [];
        setSkillsData(
          rows.map((row) => ({
            skillId: row.skill_id,
            skillName: row.skill_name,
            totalEmployees: row.total_employees,
            proficiency: row.proficiency,
          })),
        );
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load skills";
        setError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSkills();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skillsData;
    return skillsData.filter((skill) =>
      skill.skillName.toLowerCase().includes(query),
    );
  }, [skillsData, searchQuery]);

  return (
    <>
      {/* Page Header
      <div className="manager-header">
        <h2>Skills & Capability Overview</h2>
        <p className="subtitle">
          Organization-wide visibility into employee skills and proficiency.
        </p>
      </div> */}

      {/* Search */}
      <div className="log-filters">
        <div className="filter-group">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search skill (e.g. React, Java, QA)..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Skills Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Total Employees</th>
              <th>Junior</th>
              <th>Mid</th>
              <th>Senior</th>
            </tr>
          </thead>

          <tbody>
            {filteredSkills.map((skill) => (
              <tr key={skill.skillName}>
                <td>
                  <strong>{skill.skillName}</strong>
                </td>

                <td>{skill.totalEmployees}</td>

                <td>{skill.proficiency.junior}</td>

                <td>{skill.proficiency.mid}</td>

                <td>{skill.proficiency.senior}</td>
              </tr>
            ))}

            {!isLoading && !error && filteredSkills.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">No skills found.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {isLoading && (
          <div className="empty-state" style={{ paddingTop: "16px" }}>
            Loading skills…
          </div>
        )}

        {!isLoading && error && (
          <div
            className="empty-state"
            style={{ color: "var(--error)", paddingTop: "16px" }}
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
};

export default SkillsOverview;
